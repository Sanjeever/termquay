package main

import (
	"encoding/json"
	"errors"
	"path"
	"path/filepath"
	"strings"

	"github.com/Sanjeever/termquay/internal/files"
)

type SyncPreset struct {
	Name         string   `json:"name"`
	ConnectionID string   `json:"connection_id"`
	Local        string   `json:"local"`
	Remote       string   `json:"remote"`
	Direction    string   `json:"direction"`
	Exclude      []string `json:"exclude"`
}

func (a *AppService) syncPresets() ([]SyncPreset, error) {
	if err := a.openStorage(); err != nil {
		return nil, err
	}
	value, err := a.store.Setting("sync_presets")
	if err != nil {
		return nil, err
	}
	items := []SyncPreset{}
	if value != "" {
		err = json.Unmarshal([]byte(value), &items)
	}
	return items, err
}

func (a *AppService) GetSyncPresets(connectionID string) ([]SyncPreset, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	items, err := a.syncPresets()
	result := []SyncPreset{}
	for _, item := range items {
		if item.ConnectionID == connectionID {
			result = append(result, item)
		}
	}
	return result, err
}

func (a *AppService) SaveSyncPreset(preset SyncPreset) error {
	preset.Name = strings.TrimSpace(preset.Name)
	if preset.Name == "" || len(preset.Name) > 128 || !filepath.IsAbs(preset.Local) || len(preset.Local) > 4096 || !path.IsAbs(preset.Remote) || len(preset.Remote) > 4096 || (preset.Direction != "upload" && preset.Direction != "download") {
		return errors.New("同步预设名称、路径或方向无效")
	}
	if err := files.ValidateSyncExcludes(preset.Exclude); err != nil {
		return err
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	items, err := a.syncPresets()
	if err != nil {
		return err
	}
	d, err := a.store.Read()
	if err != nil {
		return err
	}
	found := false
	for _, c := range d.Connections {
		if c.ID == preset.ConnectionID && c.Protocol == "ssh" {
			found = true
			break
		}
	}
	if !found {
		return errors.New("请先保存 SSH 连接")
	}
	replaced := false
	for i, item := range items {
		if item.ConnectionID == preset.ConnectionID && item.Name == preset.Name {
			items[i] = preset
			replaced = true
			break
		}
	}
	if !replaced {
		if len(items) >= 128 {
			return errors.New("同步预设达到 128 项上限")
		}
		items = append(items, preset)
	}
	value, err := json.Marshal(items)
	if err != nil {
		return err
	}
	return a.store.SetSetting("sync_presets", string(value))
}

func (a *AppService) DeleteSyncPreset(connectionID, name string) error {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	items, err := a.syncPresets()
	if err != nil {
		return err
	}
	result := items[:0]
	for _, item := range items {
		if item.ConnectionID != connectionID || item.Name != name {
			result = append(result, item)
		}
	}
	value, err := json.Marshal(result)
	if err != nil {
		return err
	}
	return a.store.SetSetting("sync_presets", string(value))
}
