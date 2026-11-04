package app

import (
	"encoding/json"
	"errors"
	"strings"
)

type ConnectionFilter struct {
	Name        string   `json:"name"`
	View        string   `json:"view"`
	Group       string   `json:"group"`
	Protocol    string   `json:"protocol"`
	Environment string   `json:"environment"`
	Tags        []string `json:"tags"`
	Search      string   `json:"search"`
}

func (a *AppService) GetConnectionFilters() ([]ConnectionFilter, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return nil, err
	}
	value, err := a.store.Setting("connection_filters")
	if err != nil {
		return nil, err
	}
	result := []ConnectionFilter{}
	if value != "" {
		err = json.Unmarshal([]byte(value), &result)
	}
	return result, err
}

func (a *AppService) SaveConnectionFilters(filters []ConnectionFilter) error {
	if len(filters) > 32 {
		return errors.New("保存筛选最多 32 项")
	}
	seen := map[string]bool{}
	for _, filter := range filters {
		if filter.Name == "" || filter.Name != strings.TrimSpace(filter.Name) || len(filter.Name) > 128 || seen[filter.Name] || len(filter.Search) > 256 || len(filter.Group) > 256 || (filter.View != "all" && filter.View != "favorite" && filter.View != "recent") || (filter.Protocol != "all" && filter.Protocol != "ssh" && filter.Protocol != "rdp") || (filter.Environment != "" && filter.Environment != "production" && filter.Environment != "staging" && filter.Environment != "development") {
			return errors.New("保存筛选字段无效或名称重复")
		}
		if err := validateConnectionTags(filter.Tags); err != nil {
			return err
		}
		seen[filter.Name] = true
	}
	data, err := json.Marshal(filters)
	if err != nil {
		return err
	}
	if len(data) > 64<<10 {
		return errors.New("保存筛选总量超过 64 KiB")
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return err
	}
	return a.store.SetSetting("connection_filters", string(data))
}
