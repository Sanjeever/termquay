package store

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"filippo.io/age"
	"github.com/zalando/go-keyring"
)

var ErrPasswordRequired = errors.New("本机数据已使用主密码保护，请先解锁")

const passwordKeyFile = "vault-key.age"

type passwordKey struct {
	Version int    `json:"version"`
	Key     []byte `json:"key"`
}

func PasswordVaultExists(dir string) (bool, error) {
	info, err := os.Lstat(filepath.Join(dir, passwordKeyFile))
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !info.Mode().IsRegular() || info.Size() > 64<<10 {
		return false, errors.New("主密码密钥文件不是普通文件或超过大小限制")
	}
	return true, nil
}

func readPasswordKey(dir, password string) ([]byte, error) {
	exists, err := PasswordVaultExists(dir)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, errors.New("主密码密钥文件不存在")
	}
	file, err := os.Open(filepath.Join(dir, passwordKeyFile))
	if err != nil {
		return nil, err
	}
	defer file.Close()
	identity, err := age.NewScryptIdentity(password)
	if err != nil {
		return nil, err
	}
	identity.SetMaxWorkFactor(18)
	reader, err := age.Decrypt(io.LimitReader(file, (64<<10)+1), identity)
	if err != nil {
		return nil, fmt.Errorf("主密码解锁失败: %w", err)
	}
	plain, err := io.ReadAll(io.LimitReader(reader, 1025))
	if err != nil {
		return nil, fmt.Errorf("主密钥文件损坏: %w", err)
	}
	defer clear(plain)
	if len(plain) > 1024 {
		return nil, errors.New("主密钥正文超过大小限制")
	}
	var envelope passwordKey
	if err := json.Unmarshal(plain, &envelope); err != nil {
		return nil, err
	}
	if envelope.Version != 1 || len(envelope.Key) != 32 {
		clear(envelope.Key)
		return nil, errors.New("主密钥格式版本或长度不受支持")
	}
	return envelope.Key, nil
}

func writePasswordKey(dir, password string, key []byte) (err error) {
	if !utf8.ValidString(password) || utf8.RuneCountInString(password) < 8 || len(password) > 1024 || strings.TrimSpace(password) == "" {
		return errors.New("主密码须为至少 8 个字符且不超过 1024 字节")
	}
	recipient, err := age.NewScryptRecipient(password)
	if err != nil {
		return err
	}
	recipient.SetWorkFactor(18)
	plain, err := json.Marshal(passwordKey{Version: 1, Key: key})
	if err != nil {
		return err
	}
	defer clear(plain)
	if err = os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	file, err := os.CreateTemp(dir, ".termquay-vault-*")
	if err != nil {
		return err
	}
	defer func() {
		file.Close()
		if cleanupErr := os.Remove(file.Name()); cleanupErr != nil && !errors.Is(cleanupErr, os.ErrNotExist) {
			err = errors.Join(err, cleanupErr)
		}
	}()
	if err = file.Chmod(0600); err != nil {
		return err
	}
	writer, err := age.Encrypt(file, recipient)
	if err != nil {
		return err
	}
	if _, err = writer.Write(plain); err != nil {
		return err
	}
	if err = writer.Close(); err != nil {
		return err
	}
	if err = file.Sync(); err != nil {
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), filepath.Join(dir, passwordKeyFile))
}

func CreatePasswordVault(dir, password string) (*Store, error) {
	for _, name := range []string{"termquay.db", passwordKeyFile} {
		if _, err := os.Lstat(filepath.Join(dir, name)); err == nil {
			return nil, errors.New("已有本机数据，不能创建新主密钥；请先解锁或通过备份恢复")
		} else if !errors.Is(err, os.ErrNotExist) {
			return nil, err
		}
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	defer clear(key)
	if err := writePasswordKey(dir, password, key); err != nil {
		return nil, err
	}
	return Open(dir, key)
}

func UnlockPasswordVault(dir, password string) (*Store, error) {
	key, err := readPasswordKey(dir, password)
	if err != nil {
		return nil, err
	}
	defer clear(key)
	return Open(dir, key)
}

func (s *Store) verifyVaultKey(key []byte) error {
	block, err := aes.NewCipher(key)
	if err != nil {
		return err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return err
	}
	nonce := make([]byte, s.aead.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return err
	}
	probe := s.aead.Seal(nil, nonce, []byte("termquay-vault-key"), nil)
	if _, err = aead.Open(nil, nonce, probe, nil); err != nil {
		return errors.New("主密钥与当前存储不匹配，未修改保护方式")
	}
	return nil
}

func (s *Store) SetVaultPassword(current, password string) error {
	protected, err := PasswordVaultExists(s.directory)
	if err != nil {
		return err
	}
	account, err := vaultAccount(s.directory)
	if err != nil {
		return err
	}
	var key []byte
	if protected {
		key, err = readPasswordKey(s.directory, current)
	} else {
		var encoded string
		encoded, err = keyring.Get("com.termquay.app", account)
		if err == nil {
			key, err = base64.StdEncoding.DecodeString(encoded)
		}
	}
	if err != nil {
		return err
	}
	defer clear(key)
	if len(key) != 32 {
		return errors.New("主密钥长度无效")
	}
	if err = s.verifyVaultKey(key); err != nil {
		return err
	}
	if err = writePasswordKey(s.directory, password, key); err != nil {
		return err
	}
	if !protected {
		if err = keyring.Delete("com.termquay.app", account); err != nil && !errors.Is(err, keyring.ErrNotFound) {
			rollback := os.Remove(filepath.Join(s.directory, passwordKeyFile))
			return errors.Join(fmt.Errorf("系统密钥库旧副本移除失败: %w", err), rollback)
		}
	}
	return nil
}

func (s *Store) UseSystemVault(password string) error {
	key, err := readPasswordKey(s.directory, password)
	if err != nil {
		return err
	}
	defer clear(key)
	if err = s.verifyVaultKey(key); err != nil {
		return err
	}
	account, err := vaultAccount(s.directory)
	if err != nil {
		return err
	}
	if err = keyring.Set("com.termquay.app", account, base64.StdEncoding.EncodeToString(key)); err != nil {
		return err
	}
	if err = os.Remove(filepath.Join(s.directory, passwordKeyFile)); err != nil {
		return fmt.Errorf("密钥已写入系统密钥库，但主密码文件移除失败: %w", err)
	}
	return nil
}
