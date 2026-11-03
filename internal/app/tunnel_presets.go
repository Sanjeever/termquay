package app

import (
	"encoding/json"
	"errors"
	"strings"

	terminal "github.com/Sanjeever/termquay/internal/ssh"
)

type TunnelPreset struct {
	Name         string               `json:"name"`
	ConnectionID string               `json:"connection_id"`
	Spec         terminal.ForwardSpec `json:"spec"`
	AutoStart    bool                 `json:"auto_start"`
}

func (a *AppService) tunnelPresets() ([]TunnelPreset, error) {
	if err := a.openStorage(); err != nil {
		return nil, err
	}
	value, err := a.store.Setting("tunnel_presets")
	if err != nil {
		return nil, err
	}
	items := []TunnelPreset{}
	if value != "" {
		err = json.Unmarshal([]byte(value), &items)
	}
	return items, err
}

func (a *AppService) GetTunnelPresets(connectionID string) ([]TunnelPreset, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	items, err := a.tunnelPresets()
	result := []TunnelPreset{}
	for _, item := range items {
		if item.ConnectionID == connectionID {
			result = append(result, item)
		}
	}
	return result, err
}

func (a *AppService) SaveTunnelPreset(preset TunnelPreset) error {
	preset.Name = strings.TrimSpace(preset.Name)
	if preset.Name == "" || len(preset.Name) > 128 {
		return errors.New("隧道名称须为 1 至 128 字节")
	}
	if err := preset.Spec.Validate(); err != nil {
		return err
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	items, err := a.tunnelPresets()
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
			return errors.New("隧道预设达到 128 项上限")
		}
		items = append(items, preset)
	}
	count := 0
	for _, item := range items {
		if item.ConnectionID == preset.ConnectionID && item.AutoStart {
			count++
		}
	}
	if count > 4 {
		return errors.New("每个连接最多自动启动 4 个隧道")
	}
	value, err := json.Marshal(items)
	if err != nil {
		return err
	}
	return a.store.SetSetting("tunnel_presets", string(value))
}

func (a *AppService) DeleteTunnelPreset(connectionID, name string) error {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	items, err := a.tunnelPresets()
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
	return a.store.SetSetting("tunnel_presets", string(value))
}
