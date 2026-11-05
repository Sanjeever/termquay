package app

import (
	"encoding/json"
	"errors"
	"strings"
)

type ConnectionResource struct {
	Name   string `json:"name"`
	Kind   string `json:"kind"`
	Target string `json:"target"`
}

type ConnectionPlaybook struct {
	Notes     string               `json:"notes"`
	Resources []ConnectionResource `json:"resources"`
}

func (a *AppService) connectionPlaybooks() (map[string]ConnectionPlaybook, error) {
	if err := a.openStorage(); err != nil {
		return nil, err
	}
	value, err := a.store.SecretSetting("connection_playbooks")
	if err != nil {
		return nil, err
	}
	items := map[string]ConnectionPlaybook{}
	if value != "" {
		err = json.Unmarshal([]byte(value), &items)
	}
	return items, err
}

func (a *AppService) GetConnectionPlaybook(id string) (ConnectionPlaybook, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	items, err := a.connectionPlaybooks()
	item := items[id]
	if item.Resources == nil {
		item.Resources = []ConnectionResource{}
	}
	return item, err
}

func (a *AppService) SaveConnectionPlaybook(id string, item ConnectionPlaybook) error {
	if len(item.Notes) > 16<<10 || len(item.Resources) > 32 {
		return errors.New("操作手册备注最多 16 KiB，快捷资源最多 32 项")
	}
	for _, resource := range item.Resources {
		if strings.TrimSpace(resource.Name) == "" || len(resource.Name) > 128 || resource.Target == "" || len(resource.Target) > 4096 || strings.ContainsRune(resource.Target, 0) {
			return errors.New("快捷资源须有名称和有效目标")
		}
		switch resource.Kind {
		case "file", "directory", "log":
			if err := validateRemotePaths([]string{resource.Target}); err != nil {
				return err
			}
		case "service", "container", "snippet", "task", "tunnel":
		default:
			return errors.New("不支持的快捷资源类型")
		}
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	items, err := a.connectionPlaybooks()
	if err != nil {
		return err
	}
	valid, err := a.store.ConnectionIDs()
	if err != nil {
		return err
	}
	if !valid[id] {
		return errors.New("连接已不存在，请重新读取连接目录")
	}
	for key := range items {
		if !valid[key] {
			delete(items, key)
		}
	}
	if item.Notes == "" && len(item.Resources) == 0 {
		delete(items, id)
	} else {
		items[id] = item
	}
	value, err := json.Marshal(items)
	if err != nil {
		return err
	}
	if len(value) > 1<<20 {
		return errors.New("操作手册总量超过 1 MiB，请先清理旧内容")
	}
	return a.store.SetSecretSetting("connection_playbooks", string(value))
}
