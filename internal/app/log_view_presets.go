package app

import (
	"encoding/base64"
	"encoding/json"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	"strings"
)

type LogViewPreset struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Filter        string `json:"filter"`
	Exclude       string `json:"exclude"`
	Highlight     string `json:"highlight"`
	Regex         bool   `json:"regex"`
	CaseSensitive bool   `json:"case_sensitive"`
	ContextLines  int    `json:"context_lines"`
	FormatJSON    bool   `json:"format_json"`
}

func validateLogViewPreset(item LogViewPreset) error {
	if !validWorkspaceID(item.ID) || strings.TrimSpace(item.Name) == "" || len(item.Name) > 128 || len(item.Filter) > 128 || len(item.Exclude) > 128 || len(item.Highlight) > 128 || item.ContextLines < 0 || item.ContextLines > 10 {
		return appmessage.New("backend:invalidLogRuleNameExpressionOrContextLine", "日志规则名称、表达式或上下文行数无效")
	}
	return nil
}

func (a *AppService) logViewPresets() ([]LogViewPreset, error) {
	if err := a.openStorage(); err != nil {
		return nil, err
	}
	value, err := a.store.SecretSetting("log_view_presets")
	if err != nil {
		return nil, err
	}
	items := []LogViewPreset{}
	if value == "" {
		return items, nil
	}
	if len(value) > 64<<10 {
		return nil, appmessage.New("backend:logRuleStorageExceeds64KiB", "日志规则存储超过 64 KiB")
	}
	if err := decodeWorkflow(value, &items); err != nil {
		return nil, err
	}
	if err := validateLogViewPresets(items); err != nil {
		return nil, err
	}
	return items, nil
}

func validateLogViewPresets(items []LogViewPreset) error {
	if len(items) > 32 {
		return appmessage.New("backend:logRuleLimitReached32", "日志规则达到 32 项上限")
	}
	seen, names := map[string]bool{}, map[string]bool{}
	for _, item := range items {
		if err := validateLogViewPreset(item); err != nil {
			return err
		}
		if seen[item.ID] || names[item.Name] {
			return appmessage.New("backend:duplicateLogRuleIdentifierOrName", "日志规则标识或名称重复")
		}
		seen[item.ID], names[item.Name] = true, true
	}
	return nil
}

func (a *AppService) ListLogViewPresets() ([]LogViewPreset, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	return a.logViewPresets()
}

func (a *AppService) SaveLogViewPreset(item LogViewPreset) (LogViewPreset, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	items, err := a.logViewPresets()
	if err != nil {
		return LogViewPreset{}, err
	}
	creating := item.ID == ""
	if creating {
		item.ID = base64.RawURLEncoding.EncodeToString(randomBytes(16))
	}
	item.Name = strings.TrimSpace(item.Name)
	if err := validateLogViewPreset(item); err != nil {
		return LogViewPreset{}, err
	}
	index := -1
	for i, existing := range items {
		if existing.ID == item.ID {
			index = i
		}
		if existing.Name == item.Name && existing.ID != item.ID {
			return LogViewPreset{}, appmessage.New("backend:aLogRuleWithThisNameAlreadyExists", "同名日志规则已存在")
		}
	}
	if !creating && index < 0 {
		return LogViewPreset{}, appmessage.New("backend:logRuleNoLongerExistsReloadIt", "日志规则已不存在，请重新读取")
	}
	if index >= 0 {
		items[index] = item
	} else {
		items = append(items, item)
	}
	if err := validateLogViewPresets(items); err != nil {
		return LogViewPreset{}, err
	}
	value, err := json.Marshal(items)
	if err != nil {
		return LogViewPreset{}, err
	}
	if len(value) > 64<<10 {
		return LogViewPreset{}, appmessage.New("backend:logRuleStorageExceeds64KiB", "日志规则存储超过 64 KiB")
	}
	if err := a.store.SetSecretSetting("log_view_presets", string(value)); err != nil {
		return LogViewPreset{}, err
	}
	return item, nil
}

func (a *AppService) DeleteLogViewPreset(id string) error {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	items, err := a.logViewPresets()
	if err != nil {
		return err
	}
	for i, item := range items {
		if item.ID == id {
			items = append(items[:i], items[i+1:]...)
			value, err := json.Marshal(items)
			if err != nil {
				return err
			}
			return a.store.SetSecretSetting("log_view_presets", string(value))
		}
	}
	return appmessage.New("backend:logRuleNoLongerExistsReloadIt", "日志规则已不存在，请重新读取")
}
