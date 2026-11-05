package app

import (
	"encoding/json"
	"errors"
	"net"
	"net/url"
	"strings"

	terminal "github.com/Sanjeever/termquay/internal/ssh"
)

type TunnelPreset struct {
	Name         string               `json:"name"`
	ConnectionID string               `json:"connection_id"`
	Spec         terminal.ForwardSpec `json:"spec"`
	AutoStart    bool                 `json:"auto_start"`
	ServiceType  string               `json:"service_type,omitempty"`
	URLPath      string               `json:"url_path,omitempty"`
}

func validateServicePreset(preset TunnelPreset) error {
	if preset.ServiceType == "" && preset.URLPath == "" {
		return nil
	}
	if preset.ServiceType != "address" && preset.ServiceType != "http" && preset.ServiceType != "https" {
		return errors.New("服务类型须为地址、HTTP 或 HTTPS")
	}
	bind := net.ParseIP(preset.Spec.BindHost)
	if preset.Spec.Kind != "local" || bind == nil || !bind.IsLoopback() || preset.Spec.AllowPublic {
		return errors.New("服务入口须使用回环本地转发")
	}
	if preset.AutoStart {
		return errors.New("服务入口在显式打开时启动，请关闭连接后自动启动")
	}
	if len(preset.URLPath) > 2048 || strings.ContainsAny(preset.URLPath, "\r\n\x00\\") {
		return errors.New("服务 URL 路径无效或过长")
	}
	if preset.URLPath != "" {
		u, err := url.Parse(preset.URLPath)
		if err != nil || !strings.HasPrefix(preset.URLPath, "/") || strings.HasPrefix(preset.URLPath, "//") || u.IsAbs() || u.Host != "" || preset.ServiceType == "address" {
			return errors.New("URL 路径须以单个 / 开头，且仅用于 HTTP/HTTPS 服务")
		}
	}
	return nil
}

func (a *AppService) ListServiceEntries() ([]TunnelPreset, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	items, err := a.tunnelPresets()
	if err != nil {
		return nil, err
	}
	_, catalog, err := a.store.ReadCatalog()
	if err != nil {
		return nil, err
	}
	connections := map[string]bool{}
	for _, c := range catalog {
		connections[c.ID] = c.Protocol == "ssh"
	}
	result := []TunnelPreset{}
	for _, item := range items {
		if item.ServiceType != "" && connections[item.ConnectionID] {
			result = append(result, item)
		}
	}
	return result, nil
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
	if err := validateServicePreset(preset); err != nil {
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
			if item.ServiceType != "" && preset.ServiceType == "" {
				return errors.New("此预设属于服务入口，请在远端服务中编辑")
			}
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
