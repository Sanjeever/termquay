package app

import (
	"encoding/json"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	"path"
	"strings"
	"unicode"
	"unicode/utf8"
)

type WorkspaceTarget struct {
	Name          string `json:"name"`
	Protocol      string `json:"protocol"`
	Host          string `json:"host"`
	Port          int    `json:"port"`
	Username      string `json:"username"`
	Domain        string `json:"domain"`
	AuthMethod    string `json:"auth_method,omitempty"`
	IdentityAgent string `json:"identity_agent,omitempty"`
	JumpID        string `json:"jump_id,omitempty"`
	MFA           bool   `json:"mfa,omitempty"`
	ProxyAddress  string `json:"proxy_address,omitempty"`
}
type WorkspaceTabLayout struct {
	Kind        string `json:"kind"`
	Path        string `json:"path"`
	Pane        int    `json:"pane"`
	TmuxSession string `json:"tmux_session,omitempty"`
}

func validTmuxName(name string) bool {
	return name != "" && len(name) <= 128 && utf8.ValidString(name) && strings.IndexFunc(name, unicode.IsControl) < 0
}

type SSHLayout struct {
	Tabs        []WorkspaceTabLayout `json:"tabs"`
	Selected    [2]int               `json:"selected"`
	ActivePane  int                  `json:"active_pane"`
	Split       bool                 `json:"split"`
	Maximized   bool                 `json:"maximized"`
	Ratio       float64              `json:"ratio"`
	Directory   string               `json:"directory"`
	FilesOpen   bool                 `json:"files_open"`
	FilesWidth  int                  `json:"files_width"`
	MonitorOpen bool                 `json:"monitor_open"`
	Focus       bool                 `json:"focus"`
}
type WorkspaceLayoutEntry struct {
	ID           string          `json:"id"`
	ConnectionID string          `json:"connection_id"`
	Name         string          `json:"name"`
	Target       WorkspaceTarget `json:"target"`
	SSH          *SSHLayout      `json:"ssh,omitempty"`
}
type WorkspaceLayout struct {
	Version int                    `json:"version"`
	Active  string                 `json:"active"`
	Entries []WorkspaceLayoutEntry `json:"entries"`
}

func (layout WorkspaceLayout) validate() error {
	if layout.Version < 1 || layout.Version > 8 {
		return appmessage.New("backend:unsupportedWorkspaceLayoutVersion", "工作布局版本不受支持")
	}
	if len(layout.Entries) > 16 {
		return appmessage.New("backend:workspaceLayoutExceeds16Workspaces", "工作布局超过 16 个工作区")
	}
	seen := map[string]bool{}
	for _, entry := range layout.Entries {
		if !validWorkspaceID(entry.ID) || seen[entry.ID] || entry.Name == "" || len(entry.Name) > 256 || len(entry.ConnectionID) > 128 {
			return appmessage.New("backend:invalidLayoutWorkspaceIdentifierOrName", "布局工作区标识或名称无效")
		}
		seen[entry.ID] = true
		t := entry.Target
		if len(t.ProxyAddress) > 1024 || (t.ProxyAddress != "" && (layout.Version < 6 || t.Protocol != "ssh" || t.JumpID != "")) {
			return appmessage.New("backend:invalidLayoutProxyConfiguration", "布局代理配置无效")
		}
		if layout.Version < 3 && t.JumpID != "" {
			return appmessage.New("backend:legacyLayoutVersionCannotContainJumpFields", "旧布局版本不能包含跳板字段")
		}
		if (t.AuthMethod != "" && t.AuthMethod != "agent" && t.AuthMethod != "password" && t.AuthMethod != "private_key" && t.AuthMethod != "keyboard_interactive") || len(t.IdentityAgent) > 4096 || (t.Protocol != "ssh" && (t.AuthMethod != "" || t.IdentityAgent != "" || t.MFA)) || (layout.Version < 4 && (t.MFA || t.AuthMethod == "keyboard_interactive")) {
			return appmessage.New("backend:invalidLayoutAuthenticationFields", "布局认证字段无效")
		}
		if layout.Version == 1 && (t.AuthMethod != "" || t.IdentityAgent != "") {
			return appmessage.New("backend:layoutV1CannotContainNewAuthenticationFields", "v1 工作布局不能包含新认证字段")
		}
		if (t.Protocol != "ssh" && t.Protocol != "rdp") || t.Host == "" || len(t.Host) > 1024 || t.Port < 1 || t.Port > 65535 || len(t.Username) > 256 || len(t.Domain) > 256 || len(t.Name) > 256 {
			return appmessage.New("backend:invalidLayoutConnectionDestination", "布局连接目标无效")
		}
		if entry.SSH == nil {
			if t.Protocol == "ssh" {
				return appmessage.New("backend:sSHLayoutHasNoTabInformation", "SSH 布局缺少标签信息")
			}
			continue
		}
		if t.Protocol != "ssh" {
			return appmessage.New("backend:rDPLayoutCannotContainSSHTabs", "RDP 布局不能包含 SSH 标签")
		}
		s := entry.SSH
		if len(s.Tabs) > 72 || s.ActivePane < 0 || s.ActivePane > 1 || s.Ratio < 20 || s.Ratio > 80 || s.FilesWidth < 200 || s.FilesWidth > 420 || len(s.Directory) > 4096 || (s.Directory != "" && (!path.IsAbs(s.Directory) || path.Clean(s.Directory) != s.Directory)) {
			return appmessage.New("backend:invalidSSHLayoutSizeDirectoryOrTabs", "SSH 布局尺寸、目录或标签无效")
		}
		files := map[string]bool{}
		terminals := 0
		for _, tab := range s.Tabs {
			if tab.TmuxSession != "" && (layout.Version < 8 || tab.Kind != "terminal" || !validTmuxName(tab.TmuxSession)) {
				return appmessage.New("backend:invalidLayoutTmuxBindingOrLayoutVersionToo", "布局 tmux 绑定无效或版本过旧")
			}
			if tab.Pane < 0 || tab.Pane > 1 || (!s.Split && tab.Pane != 0) {
				return appmessage.New("backend:invalidLayoutPanes", "布局窗格无效")
			}
			if tab.Kind == "terminal" {
				terminals++
				if tab.Path != "" {
					return appmessage.New("backend:layoutCannotSavePTYIdentifiers", "布局不能保存 PTY 标识")
				}
			} else if tab.Kind == "file" {
				if !path.IsAbs(tab.Path) || path.Clean(tab.Path) != tab.Path || len(tab.Path) > 4096 || files[tab.Path] {
					return appmessage.New("backend:invalidOrDuplicateLayoutFileEntry", "布局文件入口无效或重复")
				}
				files[tab.Path] = true
			} else {
				return appmessage.New("backend:invalidLayoutTabType", "布局标签类型无效")
			}
		}
		if terminals > 8 || len(files) > 64 {
			return appmessage.New("backend:layoutTerminalOrFileCountExceedsTheLimit", "布局终端或文件超过上限")
		}
		for pane, index := range s.Selected {
			if index < -1 || index >= len(s.Tabs) || (index >= 0 && s.Tabs[index].Pane != pane) {
				return appmessage.New("backend:invalidSelectedLayoutTab", "布局选中标签无效")
			}
		}
	}
	if layout.Active != "" && !seen[layout.Active] {
		return appmessage.New("backend:activeLayoutWorkspaceDoesNotExist", "布局活动工作区不存在")
	}
	return nil
}
func (a *AppService) GetWorkspaceLayout() (WorkspaceLayout, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	return a.workspaceLayout()
}
func (a *AppService) workspaceLayout() (WorkspaceLayout, error) {
	empty := WorkspaceLayout{Version: 1, Entries: []WorkspaceLayoutEntry{}}
	if err := a.openStorage(); err != nil {
		return empty, err
	}
	value, err := a.store.Setting("workspace_layout")
	if err != nil || value == "" {
		return empty, err
	}
	if len(value) > 256<<10 {
		return empty, appmessage.New("backend:workspaceLayoutExceeds256KiB", "工作布局超过 256 KiB 上限")
	}
	decoder := json.NewDecoder(strings.NewReader(value))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&empty); err != nil {
		return empty, err
	}
	return empty, empty.validate()
}
func (a *AppService) SaveWorkspaceLayout(layout WorkspaceLayout) error {
	if err := layout.validate(); err != nil {
		return err
	}
	value, err := json.Marshal(layout)
	if err != nil {
		return err
	}
	if len(value) > 256<<10 {
		return appmessage.New("backend:workspaceLayoutExceeds256KiB", "工作布局超过 256 KiB 上限")
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err = a.openStorage(); err != nil {
		return err
	}
	if _, err = a.workspaceLayout(); err != nil {
		return err
	}
	return a.store.SetSetting("workspace_layout", string(value))
}
