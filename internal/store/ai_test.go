package store

import (
	"bytes"
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestAIMigrationEncryptionPaginationAndDeletion(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir, make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	before := Data{Groups: []Group{{ID: "g", Name: "组"}}, Connections: []Connection{}, Credentials: []Credential{{ID: "c", Kind: "password", Secret: "synthetic-password"}}}
	if err := s.Replace(before); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec("DROP TABLE ai_messages; DROP TABLE ai_conversations; PRAGMA user_version=1"); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = Open(dir, make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	after, err := s.Read()
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatalf("迁移丢失数据: %v", err)
	}
	ctx := context.Background()
	c := AIConversation{ID: "a", Archive: "connection:c", Title: "synthetic-title", Target: "synthetic-target", Summary: "synthetic-summary", CreatedAt: 1, UpdatedAt: 1}
	if err := s.CreateAIConversation(ctx, c); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		if _, err := s.AppendAIMessage(ctx, c.ID, `{"text":"synthetic-reference-and-output"}`); err != nil {
			t.Fatal(err)
		}
	}
	page, err := s.AIMessages(ctx, "a", 0, 2)
	if err != nil || len(page) != 2 || page[0].Seq != 4 || page[1].Seq != 5 {
		t.Fatalf("最新页错误: %+v %v", page, err)
	}
	page, err = s.AIMessages(ctx, "a", page[0].Seq, 2)
	if err != nil || page[0].Seq != 2 || page[1].Seq != 3 {
		t.Fatalf("前页错误: %+v %v", page, err)
	}
	list, err := s.ListAIConversations(ctx, c.Archive, 0, 1)
	if err != nil || len(list) != 1 || list[0].Title != c.Title {
		t.Fatalf("历史查询错误: %v", err)
	}
	if err := s.UpdateAIConversation(ctx, c); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(dir, "termquay.db"))
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{c.Title, c.Target, c.Summary, "synthetic-reference-and-output"} {
		if bytes.Contains(b, []byte(secret)) {
			t.Fatal("AI 内容明文落盘")
		}
	}
	if _, err := s.db.Exec("UPDATE ai_messages SET ciphertext=(SELECT ciphertext FROM ai_messages WHERE seq=4) WHERE seq=5"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AIMessages(ctx, "a", 0, 1); err == nil {
		t.Fatal("AAD 未绑定消息序号")
	}
	if err := s.DeleteAIConversation(ctx, "a"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AppendAIMessage(ctx, "a", `{}`); err == nil {
		t.Fatal("删除后重建历史")
	}
	if err := s.UpdateAIConversation(ctx, c); err == nil {
		t.Fatal("更新已删除对话未报错")
	}
	if _, err := s.AIConversation(ctx, "a"); err != sql.ErrNoRows {
		t.Fatalf("删除失败: %v", err)
	}
}

func TestAIRejectFutureDatabase(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir, make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec("PRAGMA user_version=999"); err != nil {
		t.Fatal(err)
	}
	s.Close()
	if s, err := Open(dir, make([]byte, 32)); err == nil {
		s.Close()
		t.Fatal("接受未来数据库")
	}
}

func TestAITemporaryArchivesSurviveReopenWithoutMerging(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir, make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	for i, c := range []AIConversation{{ID: "a", Archive: "temporary:one", Target: "a@example.invalid:22", Title: "first"}, {ID: "b", Archive: "temporary:two", Target: "a@example.invalid:22", Title: "second"}, {ID: "c", Archive: "temporary:three", Target: "b@example.invalid:22", Title: "other"}} {
		c.UpdatedAt = int64(i)
		if err := s.CreateAIConversation(ctx, c); err != nil {
			t.Fatal(err)
		}
	}
	s.Close()
	s, err = Open(dir, make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	first, err := s.ListAITemporaryConversations(ctx, "a@example.invalid:22", 0, 1)
	if err != nil || len(first) != 1 || first[0].ID != "b" {
		t.Fatalf("临时历史重开失败: %+v %v", first, err)
	}
	second, err := s.ListAITemporaryConversations(ctx, "a@example.invalid:22", 1, 1)
	if err != nil || len(second) != 1 || second[0].ID != "a" || second[0].Archive == first[0].Archive {
		t.Fatalf("临时归档被合并或分页错误: %+v %v", second, err)
	}
}
