package app

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"time"

	"github.com/Sanjeever/termquay/internal/backup"
)

type BackupSettings struct {
	Configured    bool            `json:"configured"`
	URL           string          `json:"url"`
	Username      string          `json:"username"`
	Directory     string          `json:"directory"`
	PasswordSaved bool            `json:"password_saved"`
	RecoverySaved bool            `json:"recovery_saved"`
	DeviceID      string          `json:"device_id"`
	DeviceName    string          `json:"device_name"`
	Selection     BackupSelection `json:"selection"`
}

func (a *AppService) savedBackupConfig() (automaticBackupConfig, error) {
	if _, err := a.GetAutomaticBackupStatus(); err != nil {
		return automaticBackupConfig{}, err
	}
	a.automaticMu.Lock()
	defer a.automaticMu.Unlock()
	if a.automaticConfig == nil {
		return automaticBackupConfig{}, errors.New("请先保存 WebDAV 备份位置")
	}
	return *a.automaticConfig, nil
}

func (a *AppService) saveBackupConfig(config *automaticBackupConfig) error {
	encoded, err := json.Marshal(config)
	if err != nil {
		return err
	}
	a.storeMu.Lock()
	if err = a.openStorage(); err == nil {
		err = a.store.SetSecretSetting("automatic_backup", string(encoded))
	}
	a.storeMu.Unlock()
	if err != nil {
		return err
	}
	a.automaticMu.Lock()
	defer a.automaticMu.Unlock()
	a.startAutomaticBackupLocked(config)
	return nil
}

func (a *AppService) GetBackupSettings() (BackupSettings, error) {
	if _, err := a.GetAutomaticBackupStatus(); err != nil {
		return BackupSettings{}, err
	}
	a.automaticMu.Lock()
	config := a.automaticConfig
	view := BackupSettings{Directory: "termquay/backups", Selection: BackupSelection{Snippets: true, Settings: true}}
	if config != nil {
		view.Configured = true
		view.URL, view.Username, view.Directory = config.Options.URL, config.Options.Username, config.Options.Directory
		view.PasswordSaved, view.RecoverySaved = config.Options.Password != "", config.Password != ""
		view.Selection = config.Selection
	}
	a.automaticMu.Unlock()
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	var err error
	if err = a.openStorage(); err != nil {
		return view, err
	}
	view.DeviceID, err = a.deviceID()
	if err == nil {
		view.DeviceName, err = a.deviceName()
	}
	return view, err
}

func (a *AppService) deviceName() (string, error) {
	name, err := a.store.Setting("device_name")
	if err != nil || name != "" {
		return name, err
	}
	return os.Hostname()
}

func (a *AppService) SaveBackupSettings(options backup.WebDAVOptions, password, deviceName string, selection BackupSelection) error {
	a.backupMu.Lock()
	defer a.backupMu.Unlock()
	if _, err := a.GetAutomaticBackupStatus(); err != nil {
		return err
	}
	a.automaticMu.Lock()
	config := automaticBackupConfig{Paused: true}
	if a.automaticConfig != nil {
		config = *a.automaticConfig
	}
	a.automaticMu.Unlock()
	if options.Password == "" {
		options.Password = config.Options.Password
	}
	if password == "" {
		password = config.Password
	}
	if err := options.Validate(); err != nil {
		return err
	}
	deviceName = strings.TrimSpace(deviceName)
	if deviceName == "" || len(deviceName) > 200 || strings.ContainsAny(deviceName, "\r\n\x00") {
		return errors.New("设备名称须为 1 至 200 字节的单行文字")
	}
	if len(selection.ConnectionIDs) != 0 {
		return errors.New("自动备份覆盖全部连接，请在导出文件时选择连接")
	}
	destinationChanged := config.Options.URL != options.URL || config.Options.Directory != options.Directory || config.Options.Username != options.Username
	config.Options, config.Password, config.Selection = options, password, selection
	a.storeMu.Lock()
	err := a.store.SetSetting("device_name", deviceName)
	if err == nil && destinationChanged {
		err = a.store.SetSetting("automatic_backup_last_success", "")
	}
	a.storeMu.Unlock()
	if err != nil {
		return err
	}
	if err := a.saveBackupConfig(&config); err != nil {
		return err
	}
	if destinationChanged {
		a.automaticMu.Lock()
		a.automaticStatus.LastSuccess = ""
		a.automaticMu.Unlock()
	}
	return nil
}

func (a *AppService) CheckSavedWebDAV(ctx context.Context) error {
	config, err := a.savedBackupConfig()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	return config.Options.Check(ctx)
}

func (a *AppService) SetAutomaticBackupEnabled(ctx context.Context, enabled bool) error {
	a.backupMu.Lock()
	defer a.backupMu.Unlock()
	config, err := a.savedBackupConfig()
	if err != nil {
		return err
	}
	if enabled {
		if config.Password == "" {
			return errors.New("请先设置备份加密密码")
		}
		ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
		defer cancel()
		if err := config.Options.Check(ctx); err != nil {
			return err
		}
	}
	config.Paused = !enabled
	return a.saveBackupConfig(&config)
}

func (a *AppService) ListSavedSnapshots(ctx context.Context) ([]backup.RemoteSnapshot, error) {
	config, err := a.savedBackupConfig()
	if err != nil {
		return nil, err
	}
	return config.Options.List(ctx)
}

func (a *AppService) BackupNow(ctx context.Context) (string, error) {
	a.backupMu.Lock()
	defer a.backupMu.Unlock()
	config, err := a.savedBackupConfig()
	if err != nil {
		return "", err
	}
	encrypted, device, err := a.createSnapshot(config.Password, config.Selection)
	if err != nil {
		return "", err
	}
	remote, err := config.Options.Append(ctx, device, encrypted)
	if err != nil {
		return "", err
	}
	last := time.Now().UTC().Format(time.RFC3339Nano)
	a.storeMu.Lock()
	err = a.store.SetSetting("automatic_backup_last_success", last)
	a.storeMu.Unlock()
	a.automaticMu.Lock()
	a.automaticStatus.LastSuccess = last
	a.automaticStatus.Error = ""
	a.automaticMu.Unlock()
	if err != nil {
		return remote, errors.New("备份已发布，但成功时间保存失败：" + err.Error())
	}
	return remote, nil
}
