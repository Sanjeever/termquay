package store

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

const (
	MaxAIConversations = 512
	MaxAIMessages      = 2048
	MaxAIMessageBytes  = 512 << 10
	MaxAIHistoryBytes  = 256 << 20
)

type AIConversation struct {
	ID             string `json:"id"`
	Archive        string `json:"archive"`
	ConnectionID   string `json:"connection_id"`
	Target         string `json:"target"`
	Title          string `json:"title"`
	Summary        string `json:"summary"`
	SummaryThrough int    `json:"summary_through"`
	CreatedAt      int64  `json:"created_at"`
	UpdatedAt      int64  `json:"updated_at"`
}

type AIStoredMessage struct {
	Seq  int    `json:"seq"`
	Data string `json:"data"`
}

func (s *Store) openAIValue(aad, encoded string, value any) error {
	b, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return err
	}
	n := s.aead.NonceSize()
	if len(b) < n {
		return errors.New("AI 历史密文损坏")
	}
	plain, err := s.aead.Open(nil, b[:n], b[n:], []byte("setting:"+aad))
	if err != nil {
		return fmt.Errorf("AI 历史解密失败: %w", err)
	}
	return json.Unmarshal(plain, value)
}

func (s *Store) CreateAIConversation(ctx context.Context, c AIConversation) error {
	if c.ID == "" || c.Archive == "" {
		return errors.New("AI 对话标识不能为空")
	}
	b, err := json.Marshal(c)
	if err != nil {
		return err
	}
	encoded, err := s.SealSetting("ai:conversation:"+c.ID, string(b))
	if err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var count int
	if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM ai_conversations").Scan(&count); err != nil {
		return err
	}
	if count >= MaxAIConversations {
		return errors.New("AI 历史数量达到上限，请删除旧对话")
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO ai_conversations VALUES(?,?,?,?)", c.ID, c.Archive, c.UpdatedAt, encoded); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) AIConversation(ctx context.Context, id string) (AIConversation, error) {
	var encoded string
	err := s.db.QueryRowContext(ctx, "SELECT ciphertext FROM ai_conversations WHERE id = ?", id).Scan(&encoded)
	var c AIConversation
	if err == nil {
		err = s.openAIValue("ai:conversation:"+id, encoded, &c)
	}
	return c, err
}

func (s *Store) ListAIConversations(ctx context.Context, archive string, offset, limit int) ([]AIConversation, error) {
	if offset < 0 || limit < 1 || limit > 50 {
		return nil, errors.New("AI 历史分页参数无效")
	}
	rows, err := s.db.QueryContext(ctx, "SELECT id,ciphertext FROM ai_conversations WHERE archive = ? ORDER BY updated_at DESC,id LIMIT ? OFFSET ?", archive, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AIConversation{}
	for rows.Next() {
		var id, encoded string
		if err := rows.Scan(&id, &encoded); err != nil {
			return nil, err
		}
		var c AIConversation
		if err := s.openAIValue("ai:conversation:"+id, encoded, &c); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) UpdateAIConversation(ctx context.Context, c AIConversation) error {
	b, err := json.Marshal(c)
	if err != nil {
		return err
	}
	encoded, err := s.SealSetting("ai:conversation:"+c.ID, string(b))
	if err != nil {
		return err
	}
	result, err := s.db.ExecContext(ctx, "UPDATE ai_conversations SET updated_at=?,ciphertext=? WHERE id=?", c.UpdatedAt, encoded, c.ID)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err == nil && n != 1 {
		return errors.New("AI 对话已删除")
	}
	return err
}

func (s *Store) AppendAIMessage(ctx context.Context, id, data string) (int, error) {
	if len(data) > MaxAIMessageBytes || !json.Valid([]byte(data)) {
		return 0, errors.New("AI 消息无效或超过存储限制")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	var seq, size int
	if err := tx.QueryRowContext(ctx, "SELECT coalesce(max(seq),0)+1 FROM ai_messages WHERE conversation_id=?", id).Scan(&seq); err != nil {
		return 0, err
	}
	if seq > MaxAIMessages {
		return 0, errors.New("对话消息达到上限，请新建对话")
	}
	if err := tx.QueryRowContext(ctx, "SELECT coalesce(sum(length(ciphertext)),0) FROM ai_messages").Scan(&size); err != nil {
		return 0, err
	}
	encoded, err := s.SealSetting(fmt.Sprintf("ai:message:%s:%d", id, seq), data)
	if err != nil {
		return 0, err
	}
	if size+len(encoded) > MaxAIHistoryBytes {
		return 0, errors.New("AI 历史空间达到上限，请删除旧对话")
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO ai_messages VALUES(?,?,?)", id, seq, encoded); err != nil {
		return 0, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE ai_conversations SET updated_at=? WHERE id=?", time.Now().UnixMilli(), id); err != nil {
		return 0, err
	}
	return seq, tx.Commit()
}

func (s *Store) AIMessages(ctx context.Context, id string, before, limit int) ([]AIStoredMessage, error) {
	if before < 0 || limit < 1 || limit > 100 {
		return nil, errors.New("AI 消息分页参数无效")
	}
	if before == 0 {
		before = MaxAIMessages + 1
	}
	rows, err := s.db.QueryContext(ctx, "SELECT seq,ciphertext FROM ai_messages WHERE conversation_id=? AND seq<? ORDER BY seq DESC LIMIT ?", id, before, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AIStoredMessage{}
	for rows.Next() {
		var m AIStoredMessage
		var encoded string
		if err := rows.Scan(&m.Seq, &encoded); err != nil {
			return nil, err
		}
		var v json.RawMessage
		if err := s.openAIValue(fmt.Sprintf("ai:message:%s:%d", id, m.Seq), encoded, &v); err != nil {
			return nil, err
		}
		m.Data = string(v)
		out = append(out, m)
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, rows.Err()
}

func (s *Store) DeleteAIConversation(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM ai_conversations WHERE id=?", id)
	return err
}
