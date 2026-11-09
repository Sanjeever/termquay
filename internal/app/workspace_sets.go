package app

import (
	"encoding/base64"
	"encoding/json"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	"io"
	"strings"
	"time"
	"unicode/utf8"
)

const maxWorkspaceSets = 32
const maxWorkspaceSetBytes = 2 << 20

type WorkspaceSet struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Layout    WorkspaceLayout `json:"layout"`
	UpdatedAt time.Time       `json:"updated_at"`
}

type workspaceSetData struct {
	Version int            `json:"version"`
	Items   []WorkspaceSet `json:"items"`
}

func validWorkspaceSetName(name string) bool {
	return strings.TrimSpace(name) == name && name != "" && len(name) <= 128 && utf8.ValidString(name) && !strings.ContainsAny(name, "\x00\r\n")
}

func (a *AppService) workspaceSets() ([]WorkspaceSet, error) {
	if err := a.openStorage(); err != nil {
		return nil, err
	}
	value, err := a.store.Setting("workspace_sets")
	if err != nil {
		return nil, err
	}
	return decodeWorkspaceSets(value)
}

func decodeWorkspaceSets(value string) ([]WorkspaceSet, error) {
	data := workspaceSetData{Items: []WorkspaceSet{}}
	if value == "" {
		return data.Items, nil
	}
	if len(value) > maxWorkspaceSetBytes {
		return nil, appmessage.New("backend:workingSetStorageExceeds2MiB", "工作集存储超过 2 MiB 上限")
	}
	decoder := json.NewDecoder(strings.NewReader(value))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&data); err != nil {
		return nil, err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return nil, appmessage.New("backend:workingSetStorageContainsExtraData", "工作集存储包含多余数据")
	}
	if data.Version != 1 || len(data.Items) > maxWorkspaceSets {
		return nil, appmessage.New("backend:workingSetStorageVersionUnsupportedOrCountExceeds", "工作集存储版本不受支持或数量超过上限")
	}
	ids, names := map[string]bool{}, map[string]bool{}
	for _, item := range data.Items {
		if !validWorkspaceID(item.ID) || !validWorkspaceSetName(item.Name) || ids[item.ID] || names[item.Name] || len(item.Layout.Entries) == 0 {
			return nil, appmessage.New("backend:invalidWorkingSetIdentifierNameOrLayout", "工作集标识、名称或布局无效")
		}
		if err := item.Layout.validate(); err != nil {
			return nil, err
		}
		ids[item.ID], names[item.Name] = true, true
	}
	return data.Items, nil
}

func (a *AppService) ListWorkspaceSets() ([]WorkspaceSet, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	return a.workspaceSets()
}

func (a *AppService) SaveWorkspaceSet(id, name string, layout WorkspaceLayout) (WorkspaceSet, error) {
	name = strings.TrimSpace(name)
	if !validWorkspaceSetName(name) {
		return WorkspaceSet{}, appmessage.New("backend:workingSetNameMustBeASingleLine", "工作集名称须为 1 至 128 字节的单行文字")
	}
	if err := layout.validate(); err != nil {
		return WorkspaceSet{}, err
	}
	if len(layout.Entries) == 0 {
		return WorkspaceSet{}, appmessage.New("backend:openAnSSHOrRDPWorkspaceFirst", "请先打开 SSH 或 RDP 工作区")
	}
	encoded, err := json.Marshal(layout)
	if err != nil {
		return WorkspaceSet{}, err
	}
	if len(encoded) > 256<<10 {
		return WorkspaceSet{}, appmessage.New("backend:workingSetLayoutExceeds256KiB", "单个工作集布局超过 256 KiB 上限")
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	items, err := a.workspaceSets()
	if err != nil {
		return WorkspaceSet{}, err
	}
	index := -1
	for i, item := range items {
		if item.ID == id {
			index = i
		}
		if item.Name == name && item.ID != id {
			return WorkspaceSet{}, appmessage.New("backend:aWorkingSetWithThisNameExistsUpdate", "同名工作集已存在，请选择更新或更换名称")
		}
	}
	if id == "" {
		if len(items) >= maxWorkspaceSets {
			return WorkspaceSet{}, appmessage.New("backend:workingSetLimitReached32", "工作集达到 32 项上限")
		}
		id = base64.RawURLEncoding.EncodeToString(randomBytes(16))
	} else if index < 0 {
		return WorkspaceSet{}, appmessage.New("backend:workingSetDoesNotExistReloadTheList", "工作集不存在，请重新读取")
	}
	item := WorkspaceSet{ID: id, Name: name, Layout: layout, UpdatedAt: time.Now()}
	if index >= 0 {
		items[index] = item
	} else {
		items = append(items, item)
	}
	if err := a.writeWorkspaceSets(items); err != nil {
		return WorkspaceSet{}, err
	}
	return item, nil
}

func (a *AppService) writeWorkspaceSets(items []WorkspaceSet) error {
	value, err := json.Marshal(workspaceSetData{Version: 1, Items: items})
	if err != nil {
		return err
	}
	if len(value) > maxWorkspaceSetBytes {
		return appmessage.New("backend:workingSetStorageExceeds2MiB", "工作集存储超过 2 MiB 上限")
	}
	return a.store.SetSetting("workspace_sets", string(value))
}

func (a *AppService) DeleteWorkspaceSet(id string) error {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	items, err := a.workspaceSets()
	if err != nil {
		return err
	}
	for i, item := range items {
		if item.ID == id {
			return a.writeWorkspaceSets(append(items[:i], items[i+1:]...))
		}
	}
	return appmessage.New("backend:workingSetDoesNotExistReloadTheList", "工作集不存在，请重新读取")
}
