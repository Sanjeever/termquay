package store

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/zalando/go-keyring"
)

func TestPasswordVaultLifecycle(t *testing.T) {
	keyring.MockInit()
	dir := t.TempDir()
	s, err := OpenVault(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if s != nil {
			s.Close()
		}
	}()
	if err = s.SetSecretSetting("test-secret", "vault-test-only"); err != nil {
		t.Fatal(err)
	}
	if err = s.SetVaultPassword("", "vault-test-password-one"); err != nil {
		t.Fatal(err)
	}
	account, err := vaultAccount(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = keyring.Get("com.termquay.app", account); !errors.Is(err, keyring.ErrNotFound) {
		t.Fatal("未移除旧密钥库副本", err)
	}
	if _, err = OpenVault(dir); !errors.Is(err, ErrPasswordRequired) {
		t.Fatal("主密码模式绕过了解锁", err)
	}
	if _, err = UnlockPasswordVault(dir, "incorrect-password"); err == nil {
		t.Fatal("错误主密码被接受")
	}
	if err = s.SetVaultPassword("vault-test-password-one", "vault-test-password-two"); err != nil {
		t.Fatal(err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s = nil
	s, err = UnlockPasswordVault(dir, "vault-test-password-two")
	if err != nil {
		t.Fatal(err)
	}
	secret, err := s.SecretSetting("test-secret")
	if err != nil || secret != "vault-test-only" {
		t.Fatal("改密后凭据无法解密", err)
	}
	if _, err = UnlockPasswordVault(dir, "vault-test-password-one"); err == nil {
		t.Fatal("旧主密码仍有效")
	}
	file, err := os.ReadFile(filepath.Join(dir, passwordKeyFile))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(file, []byte("vault-test-password-two")) || bytes.Contains(file, []byte("vault-test-only")) {
		t.Fatal("密钥文件包含明文")
	}
	if err = s.UseSystemVault("vault-test-password-two"); err != nil {
		t.Fatal(err)
	}
	if protected, err := PasswordVaultExists(dir); err != nil || protected {
		t.Fatal("切回密钥库后仍有主密码文件", err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s = nil
	s, err = OpenVault(dir)
	if err != nil {
		t.Fatal(err)
	}
	secret, err = s.SecretSetting("test-secret")
	if err != nil || secret != "vault-test-only" {
		t.Fatal("切回密钥库后数据不可用", err)
	}
}

func TestPasswordVaultCreationRejectsExistingDatabase(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir, make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if _, err = CreatePasswordVault(dir, "vault-test-password"); err == nil {
		t.Fatal("已有数据库被分配了新密钥")
	}
	if protected, err := PasswordVaultExists(dir); err != nil || protected {
		t.Fatal("拒绝创建后产生了密钥文件", err)
	}
}

func TestPasswordVaultCreationWithoutKeyringAndTampering(t *testing.T) {
	keyring.MockInitWithError(errors.New("test keyring unavailable"))
	dir := t.TempDir()
	s, err := CreatePasswordVault(dir, "vault-test-password")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.SetSecretSetting("test", "test-only"); err != nil {
		s.Close()
		t.Fatal(err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = UnlockPasswordVault(dir, "vault-test-password")
	if err != nil {
		t.Fatal(err)
	}
	value, err := s.SecretSetting("test")
	s.Close()
	if err != nil || value != "test-only" {
		t.Fatal("无密钥库时无法解锁持久数据", err)
	}
	filename := filepath.Join(dir, passwordKeyFile)
	data, err := os.ReadFile(filename)
	if err != nil {
		t.Fatal(err)
	}
	data[len(data)-1] ^= 1
	if err = os.WriteFile(filename, data, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = UnlockPasswordVault(dir, "vault-test-password"); err == nil {
		t.Fatal("损坏密钥文件被接受")
	}
	if _, err = OpenVault(dir); !errors.Is(err, ErrPasswordRequired) {
		t.Fatal("损坏主密码存储回退到了密钥库", err)
	}
}
