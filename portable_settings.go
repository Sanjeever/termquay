package main

import (
	"encoding/json"
	"errors"
	"regexp"
	"slices"
	"strings"
)

func validatePortableUI(values map[string]string) error {
	for key, value := range values {
		if len(value) > 16<<10 {
			return errors.New("可迁移界面设置超过 16 KiB")
		}
		switch key {
		case "appearance":
			var settings map[string]json.RawMessage
			if err := json.Unmarshal([]byte(value), &settings); err != nil || settings == nil {
				return errors.New("外观设置无效")
			}
			for field, options := range map[string]string{"theme": "dark|light|system", "uiFont": "system|yahei|pingfang", "monoFont": "system|cascadia|consolas|jetbrains", "terminalPalette": "theme|dark|light|one-dark|tokyo-night"} {
				var selected string
				if err := json.Unmarshal(settings[field], &selected); err != nil || !slices.Contains(strings.Split(options, "|"), selected) {
					return errors.New("外观设置字段无效")
				}
			}
			if raw, ok := settings["terminalLogHighlight"]; ok {
				var enabled bool
				if err := json.Unmarshal(raw, &enabled); err != nil {
					return errors.New("日志高亮设置无效")
				}
			}
		case "shortcuts":
			var shortcuts map[string]string
			if err := json.Unmarshal([]byte(value), &shortcuts); err != nil || shortcuts == nil || len(shortcuts) > 32 {
				return errors.New("快捷键设置无效")
			}
			seen := map[string]bool{}
			reserved := regexp.MustCompile(`^Mod\+(Key[ACFVXYZSWQ]|Tab|Arrow\w+)$|^(Alt\+(Tab|F4)|Mod\+Alt\+Tab|Mod\+Shift\+KeyW)$`)
			for name, shortcut := range shortcuts {
				if len(name) > 64 || len(shortcut) > 128 {
					return errors.New("快捷键字段过长")
				}
				if shortcut != "" && (seen[shortcut] || reserved.MatchString(shortcut)) {
					return errors.New("快捷键重复或占用了系统和输入组件保留组合")
				}
				seen[shortcut] = true
			}
		default:
			return errors.New("可迁移设置包含未知字段")
		}
	}
	return nil
}

func (a *AppService) portableUI() (map[string]string, error) {
	if err := a.openStorage(); err != nil {
		return nil, err
	}
	value, err := a.store.Setting("portable_ui")
	if err != nil {
		return nil, err
	}
	settings := map[string]string{}
	if value != "" {
		if err := json.Unmarshal([]byte(value), &settings); err != nil {
			return nil, err
		}
	}
	return settings, validatePortableUI(settings)
}

func (a *AppService) GetPortableUI() (map[string]string, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	return a.portableUI()
}

func (a *AppService) SavePortableUI(values map[string]string) error {
	if err := validatePortableUI(values); err != nil {
		return err
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return err
	}
	encoded, err := json.Marshal(values)
	if err != nil {
		return err
	}
	current, err := a.store.Setting("portable_ui")
	if err != nil {
		return err
	}
	if current == string(encoded) {
		return nil
	}
	return a.store.SetSetting("portable_ui", string(encoded))
}

func (a *AppService) restoreSettings(settings map[string]string) (map[string]string, map[string]string, error) {
	result, base := map[string]string{}, map[string]string{}
	ui := map[string]string{}
	for key, value := range settings {
		if key == "snippets" {
			var snippets []Snippet
			if err := json.Unmarshal([]byte(value), &snippets); err != nil {
				return nil, nil, err
			}
			if len(snippets) > 128 {
				return nil, nil, errors.New("快照片段超过 128 项")
			}
			seen := map[string]bool{}
			for _, snippet := range snippets {
				if snippet.ID == "" || seen[snippet.ID] || len(snippet.ID) > 128 || snippet.Name == "" || len(snippet.Name) > 128 || len(snippet.Group) > 128 || snippet.Body == "" || len(snippet.Body) > 32<<10 {
					return nil, nil, errors.New("快照片段字段无效")
				}
				seen[snippet.ID] = true
			}
			encoded, err := a.store.SealSetting("snippets", value)
			if err != nil {
				return nil, nil, err
			}
			result["snippets"] = encoded
		} else {
			ui[key] = value
		}
	}
	if len(ui) > 0 {
		if err := validatePortableUI(ui); err != nil {
			return nil, nil, err
		}
		current, err := a.portableUI()
		if err != nil {
			return nil, nil, err
		}
		for key, value := range ui {
			current[key] = value
		}
		encoded, err := json.Marshal(current)
		if err != nil {
			return nil, nil, err
		}
		result["portable_ui"] = string(encoded)
	}
	for key := range result {
		value, err := a.store.Setting(key)
		if err != nil {
			return nil, nil, err
		}
		base[key] = value
	}
	return result, base, nil
}
