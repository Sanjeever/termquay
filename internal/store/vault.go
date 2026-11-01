package store

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/zalando/go-keyring"
)

func OpenVault(dir string) (*Store, error) {
	canonical, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256([]byte(canonical))
	account := "master-v1-" + hex.EncodeToString(sum[:16])
	encoded, err := keyring.Get("com.termquay.app", account)
	if errors.Is(err, keyring.ErrNotFound) {
		if _, statErr := os.Stat(filepath.Join(dir, "termquay.db")); statErr == nil {
			return nil, errors.New("已有数据库的主密钥不可用，请通过备份恢复或使用会话模式")
		} else if !errors.Is(statErr, os.ErrNotExist) {
			return nil, statErr
		}
		key := make([]byte, 32)
		if _, err = rand.Read(key); err != nil {
			return nil, err
		}
		encoded = base64.StdEncoding.EncodeToString(key)
		if err = keyring.Set("com.termquay.app", account, encoded); err != nil {
			return nil, fmt.Errorf("系统密钥库保存失败，可选择会话模式: %w", err)
		}
	} else if err != nil {
		return nil, fmt.Errorf("系统密钥库读取失败，可选择会话模式: %w", err)
	}
	key, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(key) != 32 {
		return nil, errors.New("系统密钥库中的主密钥格式无效")
	}
	return Open(dir, key)
}

func (s *Store) Setting(id string) (string, error) {
	var value string
	err := s.db.QueryRow("SELECT data FROM settings WHERE id = ?", id).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return value, err
}
func (s *Store) SetSetting(id, value string) error {
	_, err := s.db.Exec("INSERT INTO settings (id,data) VALUES (?,?) ON CONFLICT (id) DO UPDATE SET data = excluded.data", id, value)
	return err
}

func (s *Store) SetSecretSetting(id, value string) error {
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return err
	}
	ciphertext := s.aead.Seal(nonce, nonce, []byte(value), []byte("setting:"+id))
	return s.SetSetting(id, base64.StdEncoding.EncodeToString(ciphertext))
}

func (s *Store) SecretSetting(id string) (string, error) {
	encoded, err := s.Setting(id)
	if err != nil || encoded == "" {
		return "", err
	}
	ciphertext, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}
	n := s.aead.NonceSize()
	if len(ciphertext) < n {
		return "", errors.New("设置密文损坏")
	}
	plain, err := s.aead.Open(nil, ciphertext[:n], ciphertext[n:], []byte("setting:"+id))
	return string(plain), err
}
