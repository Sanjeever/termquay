package app

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/Sanjeever/termquay/internal/backup"
	"github.com/Sanjeever/termquay/internal/store"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func (a *AppService) ExportLocalSnapshot(password string, selection BackupSelection) (string, error) {
	password, err := a.localSnapshotPassword(password)
	if err != nil {
		return "", err
	}
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
	return filename, writeSnapshotFile(filename, encrypted)
}

func writeSnapshotFile(filename string, encrypted []byte) error {
	file, err := os.CreateTemp(filepath.Dir(filename), ".termquay-snapshot-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	if _, err = file.Write(encrypted); err != nil {
		return err
	}
	if err = file.Sync(); err != nil {
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	if err = os.Rename(file.Name(), filename); err != nil {
		return err
	}
	return nil
}

func (a *AppService) PreviewLocalRestore(password string) (RestorePreview, error) {
	password, err := a.localSnapshotPassword(password)
	if err != nil {
		return RestorePreview{}, err
	}
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
	preview, err := a.prepareRestore(snapshot)
	if err == nil {
		a.preview.password = password
	}
	return preview, err
}

func (a *AppService) localSnapshotPassword(password string) (string, error) {
	if password != "" {
		return password, nil
	}
	if _, err := a.GetAutomaticBackupStatus(); err != nil {
		return "", err
	}
	a.automaticMu.Lock()
	defer a.automaticMu.Unlock()
	if a.automaticConfig == nil || a.automaticConfig.Password == "" {
		return "", errors.New("请输入备份加密密码")
	}
	return a.automaticConfig.Password, nil
}

func (a *AppService) protectRestore(current store.Data) error {
	password := a.preview.password
	encoded, err := a.store.SecretSetting("automatic_backup")
	if err != nil {
		return err
	}
	if encoded != "" {
		var config automaticBackupConfig
		if err := json.Unmarshal([]byte(encoded), &config); err != nil {
			return err
		}
		if config.Password != "" {
			password = config.Password
		}
	}
	if password == "" {
		return errors.New("缺少保护副本的加密密码，请重新解锁备份")
	}
	device, err := a.deviceID()
	if err != nil {
		return err
	}
	name, err := a.deviceName()
	if err != nil {
		return err
	}
	settings, err := a.portableUI()
	if err != nil {
		return err
	}
	snippets, err := a.snippets()
	if err != nil {
		return err
	}
	value, err := json.Marshal(snippets)
	if err != nil {
		return err
	}
	settings["snippets"] = string(value)
	workflows, err := a.captureWorkflowSettings(current, BackupSelection{Tasks: true, Workspaces: true, Tunnels: true, Sync: true, Preferences: true})
	if err != nil {
		return err
	}
	for key, value := range workflows {
		settings[key] = value
	}
	includeCredentials := true
	encrypted, err := backup.EncryptSnapshot(backup.Snapshot{DeviceID: device, DeviceName: name, CreatedAt: time.Now().UTC(), Data: current, Settings: settings, CredentialsIncluded: &includeCredentials}, password)
	if err != nil {
		return fmt.Errorf("创建恢复前保护副本失败：%w", err)
	}
	directory, err := a.restoreBackupDirectory()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(directory, 0700); err != nil {
		return fmt.Errorf("创建保护副本目录失败：%w", err)
	}
	filename := "before-restore-" + time.Now().UTC().Format("20060102T150405.000000000Z") + "_" + base64.RawURLEncoding.EncodeToString(randomBytes(8)) + ".json.age"
	if err := writeSnapshotFile(filepath.Join(directory, filename), encrypted); err != nil {
		return fmt.Errorf("保存恢复前保护副本失败，已停止替换：%w", err)
	}
	return nil
}

func (a *AppService) OpenRestoreBackupDirectory() error {
	a.storeMu.Lock()
	if err := a.openStorage(); err != nil {
		a.storeMu.Unlock()
		return err
	}
	directory, err := a.restoreBackupDirectory()
	a.storeMu.Unlock()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(directory, 0700); err != nil {
		return err
	}
	return application.Get().Env.OpenFileManager(directory, false)
}

func (a *AppService) restoreBackupDirectory() (string, error) {
	if a.sessionDir == "" {
		return filepath.Join(a.store.Directory(), "restore-backups"), nil
	}
	directory, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(directory, "TermQuay", "restore-backups"), nil
}
