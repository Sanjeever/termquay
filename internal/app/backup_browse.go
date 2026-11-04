package app

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/Sanjeever/termquay/internal/backup"
)

type SnapshotDetails struct {
	DeviceID            string    `json:"device_id"`
	DeviceName          string    `json:"device_name"`
	CreatedAt           time.Time `json:"created_at"`
	Connections         int       `json:"connections"`
	Credentials         int       `json:"credentials"`
	CredentialsIncluded *bool     `json:"credentials_included"`
	Settings            []string  `json:"settings"`
}

func (a *AppService) readSavedSnapshot(ctx context.Context, path, password string) (backup.Snapshot, string, error) {
	config, err := a.savedBackupConfig()
	if err != nil {
		return backup.Snapshot{}, "", err
	}
	if password == "" {
		password = config.Password
	}
	if password == "" {
		return backup.Snapshot{}, "", errors.New("请输入这份备份的加密密码")
	}
	data, err := config.Options.Read(ctx, path)
	if err != nil {
		return backup.Snapshot{}, "", err
	}
	snapshot, err := backup.Decrypt(data, password)
	return snapshot, password, err
}

func (a *AppService) GetSnapshotDetails(ctx context.Context, path, password string) (SnapshotDetails, error) {
	a.backupMu.Lock()
	defer a.backupMu.Unlock()
	snapshot, _, err := a.readSavedSnapshot(ctx, path, password)
	if err != nil {
		return SnapshotDetails{}, err
	}
	keys := make([]string, 0, len(snapshot.Settings))
	for key := range snapshot.Settings {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return SnapshotDetails{DeviceID: snapshot.DeviceID, DeviceName: snapshot.DeviceName, CreatedAt: snapshot.CreatedAt, Connections: len(snapshot.Data.Connections), Credentials: len(snapshot.Data.Credentials), CredentialsIncluded: snapshot.CredentialsIncluded, Settings: keys}, nil
}

func (a *AppService) PreviewSavedRestore(ctx context.Context, path, password string) (RestorePreview, error) {
	a.backupMu.Lock()
	defer a.backupMu.Unlock()
	a.preview = nil
	snapshot, password, err := a.readSavedSnapshot(ctx, path, password)
	if err != nil {
		return RestorePreview{}, err
	}
	preview, err := a.prepareRestore(snapshot)
	if err == nil {
		a.preview.password = password
	}
	return preview, err
}

type BackupCoverage struct {
	ConnectionID string `json:"connection_id"`
	Name         string `json:"name"`
	Reason       string `json:"reason"`
	CanSave      bool   `json:"can_save"`
}

func (a *AppService) GetBackupCoverage() ([]BackupCoverage, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return nil, err
	}
	data, err := a.store.Read()
	if err != nil {
		return nil, err
	}
	preferences, err := a.store.ConnectionPreferences()
	if err != nil {
		return nil, err
	}
	result := []BackupCoverage{}
	for _, connection := range data.Connections {
		item := BackupCoverage{ConnectionID: connection.ID, Name: connection.Name}
		switch {
		case connection.AuthMethod == "agent":
			item.Reason = "恢复后需配置本机 SSH Agent"
		case connection.AuthMethod == "keyboard_interactive":
			item.Reason = "连接时需要交互认证"
		case connection.CredentialID == "" && preferences[connection.ID].PrivateKeyPath != "":
			item.Reason, item.CanSave = "私钥仅引用本机文件，内容尚未保存", true
		case connection.CredentialID == "":
			item.Reason, item.CanSave = "未保存密码或私钥", true
		case connection.MFA:
			item.Reason = "连接时仍需完成多因素认证"
		default:
			continue
		}
		result = append(result, item)
	}
	return result, nil
}

func (a *AppService) GetBackupDeviceAliases() (map[string]string, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return nil, err
	}
	return a.backupDeviceAliases()
}

func (a *AppService) backupDeviceAliases() (map[string]string, error) {
	value, err := a.store.Setting("backup_device_aliases")
	aliases := map[string]string{}
	if err == nil && value != "" {
		err = json.Unmarshal([]byte(value), &aliases)
	}
	return aliases, err
}

func (a *AppService) SetBackupDeviceAlias(deviceID, name string) error {
	name = strings.TrimSpace(name)
	if deviceID == "" || len(deviceID) > 100 || strings.ContainsAny(deviceID, "/\\\x00") || len(name) > 200 || strings.ContainsAny(name, "\r\n\x00") {
		return errors.New("设备标识或备注无效")
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return err
	}
	aliases, err := a.backupDeviceAliases()
	if err != nil {
		return err
	}
	if name == "" {
		delete(aliases, deviceID)
	} else {
		aliases[deviceID] = name
	}
	value, err := json.Marshal(aliases)
	if err != nil {
		return err
	}
	return a.store.SetSetting("backup_device_aliases", string(value))
}
