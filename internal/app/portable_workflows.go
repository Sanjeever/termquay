package app

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path"
	"strings"
	"unicode/utf8"

	"github.com/Sanjeever/termquay/internal/backup"
	"github.com/Sanjeever/termquay/internal/files"
	"github.com/Sanjeever/termquay/internal/store"
)

type RestorePathHint struct {
	Setting string `json:"setting"`
	Name    string `json:"name"`
	Path    string `json:"path"`
}

func decodeWorkflow(value string, target any) error {
	decoder := json.NewDecoder(strings.NewReader(value))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return errors.New("工作环境设置包含额外数据")
	}
	return nil
}

func validateWorkflowSettings(values map[string]string, data store.Data, checkReferences bool) (map[string]int, []RestorePathHint, error) {
	counts, hints := map[string]int{}, []RestorePathHint{}
	connections := map[string]store.Connection{}
	for _, c := range data.Connections {
		connections[c.ID] = c
	}
	for key, value := range values {
		if !backup.IsWorkflowSetting(key) {
			continue
		}
		limit := 1 << 20
		if key == "workspace_sets" {
			limit = maxWorkspaceSetBytes
		}
		if len(value) > limit || strings.TrimSpace(value) == "null" {
			return nil, nil, errors.New("工作环境设置为空或超过大小上限")
		}
		switch key {
		case "log_view_presets":
			var items []LogViewPreset
			if len(value) > 64<<10 {
				return nil, nil, errors.New("日志规则超过 64 KiB")
			}
			if err := decodeWorkflow(value, &items); err != nil {
				return nil, nil, err
			}
			if err := validateLogViewPresets(items); err != nil {
				return nil, nil, err
			}
			counts[key] = len(items)
		case "command_tasks":
			var items []CommandTask
			if err := decodeWorkflow(value, &items); err != nil {
				return nil, nil, err
			}
			if len(items) > 64 {
				return nil, nil, errors.New("命令任务超过 64 项")
			}
			seen := map[string]bool{}
			for _, item := range items {
				if !validWorkspaceID(item.ID) || seen[item.ID] {
					return nil, nil, errors.New("命令任务标识无效或重复")
				}
				if err := validateCommandTask(item); err != nil {
					return nil, nil, err
				}
				seen[item.ID] = true
			}
			counts[key] = len(items)
		case "workspace_sets":
			items, err := decodeWorkspaceSets(value)
			if err != nil {
				return nil, nil, err
			}
			for _, item := range items {
				for _, entry := range item.Layout.Entries {
					if _, ok := connections[entry.ConnectionID]; checkReferences && (!ok || entry.Target.JumpID != "" && connections[entry.Target.JumpID].ID == "") {
						return nil, nil, errors.New("工作集引用了快照之外的连接或跳板")
					}
				}
			}
			counts[key] = len(items)
		case "tunnel_presets":
			var items []TunnelPreset
			if err := decodeWorkflow(value, &items); err != nil {
				return nil, nil, err
			}
			if len(items) > 128 {
				return nil, nil, errors.New("隧道预设超过 128 项")
			}
			seen, automatic := map[string]bool{}, map[string]int{}
			for _, item := range items {
				id := item.ConnectionID + "\x00" + item.Name
				if checkReferences && connections[item.ConnectionID].Protocol != "ssh" || strings.TrimSpace(item.Name) == "" || len(item.Name) > 128 || seen[id] {
					return nil, nil, errors.New("隧道预设名称、连接或重复项无效")
				}
				if err := item.Spec.Validate(); err != nil {
					return nil, nil, err
				}
				seen[id] = true
				if item.AutoStart {
					automatic[item.ConnectionID]++
					if automatic[item.ConnectionID] > 4 {
						return nil, nil, errors.New("连接自动启动的隧道超过 4 项")
					}
				}
			}
			counts[key] = len(items)
		case "sync_presets":
			var items []SyncPreset
			if err := decodeWorkflow(value, &items); err != nil {
				return nil, nil, err
			}
			if len(items) > 128 {
				return nil, nil, errors.New("同步预设超过 128 项")
			}
			seen := map[string]bool{}
			for _, item := range items {
				id := item.ConnectionID + "\x00" + item.Name
				if checkReferences && connections[item.ConnectionID].Protocol != "ssh" || strings.TrimSpace(item.Name) == "" || len(item.Name) > 128 || item.Local == "" || len(item.Local) > 4096 || strings.ContainsRune(item.Local, 0) || !path.IsAbs(item.Remote) || len(item.Remote) > 4096 || (item.Direction != "upload" && item.Direction != "download") || seen[id] {
					return nil, nil, errors.New("同步预设名称、连接、路径或方向无效")
				}
				if err := files.ValidateSyncExcludes(item.Exclude); err != nil {
					return nil, nil, err
				}
				seen[id] = true
				hints = append(hints, RestorePathHint{Setting: key, Name: item.Name, Path: item.Local})
			}
			counts[key] = len(items)
		case "connection_preferences":
			var items map[string]store.ConnectionPreference
			if err := decodeWorkflow(value, &items); err != nil {
				return nil, nil, err
			}
			for id, item := range items {
				if err := validateConnectionTags(item.Tags); err != nil {
					return nil, nil, err
				}
				if checkReferences && connections[id].ID == "" || len(item.Bookmarks) > 32 || len(item.PrivateKeyPath) > 4096 || strings.ContainsRune(item.PrivateKeyPath, 0) || item.Environment != "" && item.Environment != "production" && item.Environment != "staging" && item.Environment != "development" || item.RDPResolution != "" && item.RDPResolution != "dynamic" && item.RDPResolution != "1280x800" && item.RDPResolution != "1920x1080" && item.RDPResolution != "multimon" || item.RDPClient != "" && item.RDPClient != "internal" && item.RDPClient != "system" {
					return nil, nil, errors.New("连接偏好字段或引用无效")
				}
				seen := map[string]bool{}
				for _, bookmark := range item.Bookmarks {
					if !path.IsAbs(bookmark) || path.Clean(bookmark) != bookmark || len(bookmark) > 4096 || seen[bookmark] {
						return nil, nil, errors.New("目录书签无效或重复")
					}
					seen[bookmark] = true
				}
				if item.PrivateKeyPath != "" {
					hints = append(hints, RestorePathHint{Setting: key, Name: connections[id].Name, Path: item.PrivateKeyPath})
				}
			}
			counts[key] = len(items)
		}
	}
	return counts, hints, nil
}

func (a *AppService) captureWorkflowSettings(data store.Data, selection BackupSelection) (map[string]string, error) {
	values := map[string]string{}
	choices := []struct {
		key     string
		enabled bool
	}{{"command_tasks", selection.Tasks}, {"workspace_sets", selection.Workspaces}, {"tunnel_presets", selection.Tunnels}, {"sync_presets", selection.Sync}, {"connection_preferences", selection.Preferences}, {"log_view_presets", selection.LogRules}}
	for _, choice := range choices {
		if !choice.enabled {
			continue
		}
		var value string
		var err error
		if choice.key == "command_tasks" || choice.key == "log_view_presets" {
			value, err = a.store.SecretSetting(choice.key)
		} else {
			value, err = a.store.Setting(choice.key)
		}
		if err != nil {
			return nil, err
		}
		if value == "" {
			value = "[]"
			if choice.key == "workspace_sets" {
				value = `{"version":1,"items":[]}`
			}
			if choice.key == "connection_preferences" {
				value = "{}"
			}
		}
		values[choice.key] = value
	}
	filtered, err := a.remapWorkflowSettings(values, data, nil, false, false)
	if err != nil {
		return nil, err
	}
	_, _, err = validateWorkflowSettings(filtered, data, true)
	return filtered, err
}

func (a *AppService) remapWorkflowSettings(values map[string]string, data store.Data, ids map[string]string, importing, restoring bool) (map[string]string, error) {
	result := map[string]string{}
	valid := map[string]bool{}
	for _, c := range data.Connections {
		valid[c.ID] = true
	}
	connectionID := func(id string) string {
		if ids != nil {
			return ids[id]
		}
		if valid[id] {
			return id
		}
		return ""
	}
	encode := func(key string, value any) error {
		raw, err := json.Marshal(value)
		if err == nil {
			result[key] = string(raw)
		}
		return err
	}
	for key, value := range values {
		switch key {
		case "log_view_presets":
			var items []LogViewPreset
			if err := decodeWorkflow(value, &items); err != nil {
				return nil, err
			}
			if importing {
				current, err := a.logViewPresets()
				if err != nil {
					return nil, err
				}
				names := map[string]bool{}
				for _, item := range current {
					names[item.Name] = true
				}
				for i := range items {
					items[i].ID = base64.RawURLEncoding.EncodeToString(randomBytes(16))
					items[i].Name = importedWorkflowName(items[i].Name, names)
					names[items[i].Name] = true
				}
				items = append(current, items...)
			}
			if err := encode(key, items); err != nil {
				return nil, err
			}
		case "command_tasks":
			var items []CommandTask
			if err := decodeWorkflow(value, &items); err != nil {
				return nil, err
			}
			if importing {
				current, err := a.commandTasks()
				if err != nil {
					return nil, err
				}
				for i := range items {
					items[i].ID = base64.RawURLEncoding.EncodeToString(randomBytes(16))
				}
				items = append(current, items...)
			}
			if err := encode(key, items); err != nil {
				return nil, err
			}
		case "workspace_sets":
			items, err := decodeWorkspaceSets(value)
			if err != nil {
				return nil, err
			}
			output := []WorkspaceSet{}
			names := map[string]bool{}
			if importing {
				output, err = a.workspaceSets()
				if err != nil {
					return nil, err
				}
				for _, item := range output {
					names[item.Name] = true
				}
			}
			for _, item := range items {
				entries := []WorkspaceLayoutEntry{}
				for _, entry := range item.Layout.Entries {
					id := connectionID(entry.ConnectionID)
					if id == "" || entry.Target.JumpID != "" && connectionID(entry.Target.JumpID) == "" {
						continue
					}
					entry.ConnectionID = id
					if entry.Target.JumpID != "" {
						entry.Target.JumpID = connectionID(entry.Target.JumpID)
					}
					entries = append(entries, entry)
				}
				if len(entries) == 0 {
					continue
				}
				item.Layout.Entries = entries
				activeFound := false
				for _, entry := range entries {
					if entry.ID == item.Layout.Active {
						activeFound = true
					}
				}
				if !activeFound {
					item.Layout.Active = entries[0].ID
				}
				if importing {
					item.ID = base64.RawURLEncoding.EncodeToString(randomBytes(16))
					item.Name = importedWorkflowName(item.Name, names)
					names[item.Name] = true
				}
				output = append(output, item)
			}
			if err := encode(key, workspaceSetData{Version: 1, Items: output}); err != nil {
				return nil, err
			}
		case "tunnel_presets":
			var items []TunnelPreset
			if err := decodeWorkflow(value, &items); err != nil {
				return nil, err
			}
			output := []TunnelPreset{}
			if importing {
				var err error
				output, err = a.tunnelPresets()
				if err != nil {
					return nil, err
				}
			}
			for _, item := range items {
				id := connectionID(item.ConnectionID)
				if id == "" {
					continue
				}
				item.ConnectionID = id
				if restoring {
					item.AutoStart = false
				}
				output = append(output, item)
			}
			if err := encode(key, output); err != nil {
				return nil, err
			}
		case "sync_presets":
			var items []SyncPreset
			if err := decodeWorkflow(value, &items); err != nil {
				return nil, err
			}
			output := []SyncPreset{}
			if importing {
				var err error
				output, err = a.syncPresets()
				if err != nil {
					return nil, err
				}
			}
			for _, item := range items {
				id := connectionID(item.ConnectionID)
				if id == "" {
					continue
				}
				item.ConnectionID = id
				output = append(output, item)
			}
			if err := encode(key, output); err != nil {
				return nil, err
			}
		case "connection_preferences":
			var items map[string]store.ConnectionPreference
			if err := decodeWorkflow(value, &items); err != nil {
				return nil, err
			}
			output := map[string]store.ConnectionPreference{}
			if importing {
				var err error
				output, err = a.store.ConnectionPreferences()
				if err != nil {
					return nil, err
				}
				for id := range output {
					if !valid[id] {
						delete(output, id)
					}
				}
			}
			for id, item := range items {
				mapped := connectionID(id)
				if mapped == "" {
					continue
				}
				item.LastConnected = nil
				if restoring {
					item.PrivateKeyPath = ""
				}
				output[mapped] = item
			}
			if err := encode(key, output); err != nil {
				return nil, err
			}
		}
	}
	return result, nil
}

func importedWorkflowName(name string, names map[string]bool) string {
	base := name
	for n := 2; names[name]; n++ {
		suffix := fmt.Sprintf("（导入 %d）", n)
		for len(base)+len(suffix) > 128 {
			_, size := utf8.DecodeLastRuneInString(base)
			base = base[:len(base)-size]
		}
		name = base + suffix
	}
	return name
}
