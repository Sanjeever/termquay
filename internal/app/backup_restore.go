package app

import (
	"context"
	"encoding/base64"
	"errors"
	"reflect"
	"sort"
	"time"

	"github.com/Sanjeever/termquay/internal/backup"
	"github.com/Sanjeever/termquay/internal/store"
)

type RestorePreview struct {
	ID                  string             `json:"id"`
	DeviceID            string             `json:"device_id"`
	DeviceName          string             `json:"device_name"`
	CredentialsIncluded *bool              `json:"credentials_included"`
	CredentialUpdated   []string           `json:"credential_updated"`
	CreatedAt           time.Time          `json:"created_at"`
	Added               []string           `json:"added"`
	Updated             []string           `json:"updated"`
	Removed             []string           `json:"removed"`
	Credentials         int                `json:"credentials"`
	Connections         []store.Connection `json:"connections"`
	Settings            []string           `json:"settings"`
	SettingCounts       map[string]int     `json:"setting_counts"`
	PathHints           []RestorePathHint  `json:"path_hints"`
}

type pendingRestore struct {
	id                string
	data              store.Data
	base              store.Data
	expires           time.Time
	settingsBase      map[string]string
	sourceSettings    map[string]string
	password          string
	recoveryRecipient string
}

func (a *AppService) PreviewRestore(ctx context.Context, options backup.WebDAVOptions, path, password string) (RestorePreview, error) {
	a.backupMu.Lock()
	defer a.backupMu.Unlock()
	a.preview = nil
	encrypted, err := options.Read(ctx, path)
	if err != nil {
		return RestorePreview{}, err
	}
	snap, err := backup.Decrypt(encrypted, password)
	if err != nil {
		return RestorePreview{}, err
	}
	preview, err := a.prepareRestore(snap)
	if err == nil {
		a.preview.password = password
	}
	return preview, err
}

func (a *AppService) prepareRestore(snap backup.Snapshot) (RestorePreview, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return RestorePreview{}, err
	}
	current, err := a.store.Read()
	if err != nil {
		return RestorePreview{}, err
	}
	id := base64.RawURLEncoding.EncodeToString(randomBytes(24))
	p := RestorePreview{ID: id, DeviceID: snap.DeviceID, DeviceName: snap.DeviceName, CredentialsIncluded: snap.CredentialsIncluded, CreatedAt: snap.CreatedAt, Added: []string{}, Updated: []string{}, Removed: []string{}, Credentials: len(snap.Data.Credentials), CredentialUpdated: []string{}}
	p.Connections = snap.Data.Connections
	p.SettingCounts, p.PathHints, err = validateWorkflowSettings(snap.Settings, snap.Data, true)
	if err != nil {
		return RestorePreview{}, err
	}
	_, base, err := a.restoreSettings(snap.Settings)
	if err != nil {
		return RestorePreview{}, err
	}
	for key := range snap.Settings {
		p.Settings = append(p.Settings, key)
	}
	sort.Strings(p.Settings)
	old := map[string]store.Connection{}
	oldCredentials := map[string]store.Credential{}
	newCredentials := map[string]store.Credential{}
	for _, credential := range current.Credentials {
		oldCredentials[credential.ID] = credential
	}
	for _, credential := range snap.Data.Credentials {
		newCredentials[credential.ID] = credential
	}
	for _, c := range current.Connections {
		old[c.ID] = c
	}
	for _, c := range snap.Data.Connections {
		before, ok := old[c.ID]
		if !ok {
			p.Added = append(p.Added, c.Name)
		} else if !reflect.DeepEqual(before, c) {
			p.Updated = append(p.Updated, c.Name)
		}
		if ok && !reflect.DeepEqual(oldCredentials[before.CredentialID], newCredentials[c.CredentialID]) {
			p.CredentialUpdated = append(p.CredentialUpdated, c.Name)
		}
		delete(old, c.ID)
	}
	for _, c := range old {
		p.Removed = append(p.Removed, c.Name)
	}
	sort.Strings(p.Removed)
	a.preview = &pendingRestore{id: id, data: snap.Data, base: current, expires: time.Now().Add(5 * time.Minute), settingsBase: base, sourceSettings: snap.Settings}
	return p, nil
}

func (a *AppService) ConfirmRestore(id string) error {
	return a.ConfirmRestoreSelection(id, nil, true, true)
}

func (a *AppService) ConfirmRestoreSelection(id string, connectionIDs []string, replace, restoreSettings bool) error {
	keys := []string{}
	if restoreSettings {
		keys = []string{"snippets", "appearance", "shortcuts"}
	}
	return a.ConfirmRestoreWithOptions(id, connectionIDs, replace, keys)
}

func (a *AppService) ConfirmRestoreWithOptions(id string, connectionIDs []string, replace bool, settingKeys []string) error {
	a.backupMu.Lock()
	defer a.backupMu.Unlock()
	if a.preview == nil || a.preview.id != id {
		return errors.New("恢复预览已失效，请重新预览")
	}
	if time.Now().After(a.preview.expires) {
		a.preview = nil
		return errors.New("恢复预览已失效，请重新预览")
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return err
	}
	current, err := a.store.Read()
	if err != nil {
		return err
	}
	if !reflect.DeepEqual(current, a.preview.base) {
		return errors.New("本地连接在预览后发生变化，请重新预览")
	}
	data := a.preview.data
	settings := map[string]string{}
	selectedSettings := map[string]string{}
	for _, key := range settingKeys {
		if key != "snippets" && key != "appearance" && key != "shortcuts" && !backup.IsWorkflowSetting(key) {
			return errors.New("恢复设置包含未知选项")
		}
		if value, ok := a.preview.sourceSettings[key]; ok {
			selectedSettings[key] = value
		}
	}
	if len(selectedSettings) > 0 {
		for sourceKey := range selectedSettings {
			key := "portable_ui"
			if sourceKey == "snippets" || backup.IsWorkflowSetting(sourceKey) {
				key = sourceKey
			}
			expected := a.preview.settingsBase[key]
			value, err := a.store.Setting(key)
			if err != nil {
				return err
			}
			if value != expected {
				return errors.New("本机设置在预览后发生变化，请重新预览")
			}
		}
	}
	var ids map[string]string
	if !replace {
		selected, err := selectSnapshotData(data, connectionIDs)
		if err != nil {
			return err
		}
		data, ids = mergeSnapshotCopies(current, selected)
	}
	workflows, err := a.remapWorkflowSettings(selectedSettings, data, ids, !replace, true)
	if err != nil {
		return err
	}
	if _, _, err := validateWorkflowSettings(workflows, data, false); err != nil {
		return err
	}
	for key, value := range workflows {
		selectedSettings[key] = value
	}
	settings, _, err = a.restoreSettings(selectedSettings)
	if err != nil {
		return err
	}
	if replace {
		if err := a.protectRestore(current); err != nil {
			return err
		}
	}
	if err := a.store.ReplaceWithSettings(data, settings); err != nil {
		return err
	}
	a.preview = nil
	return nil
}

func (a *AppService) CancelRestorePreview(id string) {
	a.backupMu.Lock()
	defer a.backupMu.Unlock()
	if a.preview != nil && a.preview.id == id {
		a.preview = nil
	}
}
