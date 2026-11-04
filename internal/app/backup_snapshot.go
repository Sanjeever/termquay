package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"time"

	"github.com/Sanjeever/termquay/internal/backup"
	"github.com/Sanjeever/termquay/internal/store"
)

func (a *AppService) BackupWebDAV(ctx context.Context, options backup.WebDAVOptions, password string, includeCredentials bool) (string, error) {
	return a.BackupWebDAVWithSelection(ctx, options, password, BackupSelection{Credentials: includeCredentials})
}

func (a *AppService) BackupWebDAVWithSelection(ctx context.Context, options backup.WebDAVOptions, password string, selection BackupSelection) (string, error) {
	a.backupMu.Lock()
	defer a.backupMu.Unlock()
	encrypted, device, err := a.createSnapshot(password, selection)
	if err != nil {
		return "", err
	}
	return options.Append(ctx, device, encrypted)
}

func (a *AppService) createSnapshot(password string, selection BackupSelection) ([]byte, string, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return nil, "", err
	}
	d, err := a.store.Read()
	device, deviceErr := a.deviceID()
	if err != nil {
		return nil, "", err
	}
	if deviceErr != nil {
		return nil, "", deviceErr
	}
	if len(selection.ConnectionIDs) > 0 {
		d, err = selectSnapshotData(d, selection.ConnectionIDs)
		if err != nil {
			return nil, "", err
		}
	}
	if !selection.Credentials {
		d.Credentials = []store.Credential{}
		for i := range d.Connections {
			d.Connections[i].CredentialID = ""
		}
	}
	settings := map[string]string{}
	if selection.Snippets {
		values, err := a.snippets()
		if err != nil {
			return nil, "", err
		}
		encoded, err := json.Marshal(values)
		if err != nil {
			return nil, "", err
		}
		settings["snippets"] = string(encoded)
	}
	if selection.Settings {
		ui, err := a.portableUI()
		if err != nil {
			return nil, "", err
		}
		for key, value := range ui {
			settings[key] = value
		}
	}
	workflows, err := a.captureWorkflowSettings(d, selection)
	if err != nil {
		return nil, "", err
	}
	for key, value := range workflows {
		settings[key] = value
	}
	name, err := a.deviceName()
	if err != nil {
		return nil, "", err
	}
	encrypted, err := backup.EncryptSnapshot(backup.Snapshot{DeviceID: device, DeviceName: name, CreatedAt: time.Now().UTC(), Data: d, Settings: settings, CredentialsIncluded: &selection.Credentials}, password)
	return encrypted, device, err
}

func (a *AppService) deviceID() (string, error) {
	id, err := a.store.Setting("device_id")
	if err != nil {
		return "", err
	}
	if id == "" {
		id = base64.RawURLEncoding.EncodeToString(randomBytes(16))
		err = a.store.SetSetting("device_id", id)
	}
	return id, err
}

func (a *AppService) TestWebDAV(ctx context.Context, options backup.WebDAVOptions) error {
	return options.Test(ctx)
}
func (a *AppService) ListSnapshots(ctx context.Context, options backup.WebDAVOptions) ([]backup.RemoteSnapshot, error) {
	return options.List(ctx)
}
