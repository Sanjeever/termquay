package app

import (
	"errors"
	"io"
	"os"
	"path/filepath"

	"github.com/Sanjeever/termquay/internal/backup"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func (a *AppService) ExportLocalSnapshot(password string, selection BackupSelection) (string, error) {
	filename, err := application.Get().Dialog.SaveFile().SetMessage("导出加密快照").SetFilename("termquay.json.age").PromptForSingleSelection()
	if err != nil || filename == "" {
		return "", err
	}
	a.backupMu.Lock()
	defer a.backupMu.Unlock()
	encrypted, _, err := a.createSnapshot(password, selection)
	if err != nil {
		return "", err
	}
	file, err := os.CreateTemp(filepath.Dir(filename), ".termquay-snapshot-*")
	if err != nil {
		return "", err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	if _, err = file.Write(encrypted); err != nil {
		return "", err
	}
	if err = file.Sync(); err != nil {
		return "", err
	}
	if err = file.Close(); err != nil {
		return "", err
	}
	if err = os.Rename(file.Name(), filename); err != nil {
		return "", err
	}
	return filename, nil
}

func (a *AppService) PreviewLocalRestore(password string) (RestorePreview, error) {
	filename, err := application.Get().Dialog.OpenFile().SetTitle("选择加密快照").PromptForSingleSelection()
	if err != nil || filename == "" {
		return RestorePreview{}, err
	}
	file, err := os.Open(filename)
	if err != nil {
		return RestorePreview{}, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return RestorePreview{}, err
	}
	if !info.Mode().IsRegular() || info.Size() > backup.MaxSnapshot+(1<<20) {
		return RestorePreview{}, errors.New("快照须为大小受限的普通文件")
	}
	data, err := io.ReadAll(io.LimitReader(file, backup.MaxSnapshot+(1<<20)+1))
	if err != nil {
		return RestorePreview{}, err
	}
	if len(data) > backup.MaxSnapshot+(1<<20) {
		return RestorePreview{}, errors.New("加密快照超过限制")
	}
	a.backupMu.Lock()
	defer a.backupMu.Unlock()
	a.preview = nil
	snapshot, err := backup.Decrypt(data, password)
	if err != nil {
		return RestorePreview{}, err
	}
	return a.prepareRestore(snapshot)
}
