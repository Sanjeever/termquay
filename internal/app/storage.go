package app

import (
	"os"
	"path/filepath"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	"github.com/Sanjeever/termquay/internal/store"
)

func (a *AppService) openStorage() error {
	if a.store != nil {
		return nil
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return err
	}
	a.store, err = store.OpenVault(filepath.Join(dir, "TermQuay"))
	if err == nil {
		a.store.SetChangeListener(a.queueAutomaticBackup)
	}
	return err
}

func (a *AppService) UseSessionStorage() error {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if a.store != nil {
		return appmessage.New("backend:storageIsAlreadyOpen", "存储已经打开")
	}
	dir, err := os.MkdirTemp("", "termquay-session-")
	if err != nil {
		return err
	}
	a.store, err = store.Open(dir, randomBytes(32))
	if err != nil {
		os.RemoveAll(dir)
		return err
	}
	a.sessionDir = dir
	a.store.SetChangeListener(a.queueAutomaticBackup)
	return nil
}
