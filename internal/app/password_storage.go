package app

import (
	"errors"
	"os"
	"path/filepath"

	"github.com/Sanjeever/termquay/internal/store"
)

type StorageStatus struct {
	Mode      string `json:"mode"`
	Unlocked  bool   `json:"unlocked"`
	CanCreate bool   `json:"can_create"`
}

func storageDirectory() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "TermQuay"), nil
}

func (a *AppService) GetStorageStatus() (StorageStatus, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if a.sessionDir != "" {
		return StorageStatus{Mode: "session", Unlocked: true}, nil
	}
	dir, err := storageDirectory()
	if err != nil {
		return StorageStatus{}, err
	}
	protected, err := store.PasswordVaultExists(dir)
	if err != nil {
		return StorageStatus{}, err
	}
	_, dbError := os.Lstat(filepath.Join(dir, "termquay.db"))
	if dbError != nil && !errors.Is(dbError, os.ErrNotExist) {
		return StorageStatus{}, dbError
	}
	mode := "keyring"
	if protected {
		mode = "password"
	}
	return StorageStatus{Mode: mode, Unlocked: a.store != nil, CanCreate: a.store == nil && !protected && errors.Is(dbError, os.ErrNotExist)}, nil
}

func (a *AppService) UnlockPasswordStorage(password string) error {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if a.store != nil {
		return errors.New("本机存储已经打开")
	}
	dir, err := storageDirectory()
	if err != nil {
		return err
	}
	a.store, err = store.UnlockPasswordVault(dir, password)
	if err == nil {
		a.store.SetChangeListener(a.queueAutomaticBackup)
	}
	return err
}
func (a *AppService) CreatePasswordStorage(password string) error {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if a.store != nil {
		return errors.New("本机存储已经打开，请从凭据设置切换保护方式")
	}
	dir, err := storageDirectory()
	if err != nil {
		return err
	}
	a.store, err = store.CreatePasswordVault(dir, password)
	if err == nil {
		a.store.SetChangeListener(a.queueAutomaticBackup)
	}
	return err
}
func (a *AppService) SetStoragePassword(current, password string) error {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if a.store == nil || a.sessionDir != "" {
		return errors.New("请先打开持久存储；会话存储不能切换保护方式")
	}
	return a.store.SetVaultPassword(current, password)
}
func (a *AppService) UseSystemStorage(password string) error {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if a.store == nil || a.sessionDir != "" {
		return errors.New("请先打开主密码持久存储")
	}
	return a.store.UseSystemVault(password)
}
