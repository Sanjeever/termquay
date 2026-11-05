package app

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/Sanjeever/termquay/internal/files"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
)

const fileHistoryLimit = 16 << 20
const maxFileHistories = 64

type FileVersion struct {
	ID       string    `json:"id"`
	Time     time.Time `json:"time"`
	Size     int       `json:"size"`
	Revision string    `json:"revision"`
}
type FileHistory struct {
	Enabled     bool          `json:"enabled"`
	Validate    string        `json:"validate"`
	Reload      string        `json:"reload"`
	HealthCheck string        `json:"health_check,omitempty"`
	Versions    []FileVersion `json:"versions"`
}
type storedFileHistory struct {
	FileHistory
	Automatic bool `json:"automatic,omitempty"`
}

func (a *AppService) fileHistoryKey(workspace, remote string) (string, error) {
	if err := validateRemotePaths([]string{remote}); err != nil {
		return "", err
	}
	a.mu.Lock()
	owner := a.workspaces[workspace]
	a.mu.Unlock()
	if owner == nil {
		return "", errors.New("SSH 工作区已关闭")
	}
	sum := sha256.Sum256([]byte(owner.target + "\x00" + owner.identity + "\x00" + remote))
	return hex.EncodeToString(sum[:]), nil
}
func (a *AppService) fileHistories() (map[string]storedFileHistory, error) {
	if err := a.openStorage(); err != nil {
		return nil, err
	}
	value, err := a.store.SecretSetting("file_histories")
	if err != nil {
		return nil, err
	}
	items := map[string]storedFileHistory{}
	if value != "" {
		err = json.Unmarshal([]byte(value), &items)
	}
	return items, err
}
func (a *AppService) GetFileHistory(workspace, remote string) (FileHistory, error) {
	key, err := a.fileHistoryKey(workspace, remote)
	if err != nil {
		return FileHistory{}, err
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	items, err := a.fileHistories()
	if item, exists := items[key]; exists {
		return item.FileHistory, err
	}
	return FileHistory{Enabled: true}, err
}
func (a *AppService) SetFileHistory(workspace, remote string, enabled bool, validate, reload string) error {
	return a.setFileWorkflow(workspace, remote, enabled, validate, reload, nil)
}

func (a *AppService) ConfigureFileWorkflow(workspace, remote string, enabled bool, validate, reload, health string) error {
	return a.setFileWorkflow(workspace, remote, enabled, validate, reload, &health)
}

func (a *AppService) setFileWorkflow(workspace, remote string, enabled bool, validate, reload string, health *string) error {
	if len(validate) > 8192 || len(reload) > 8192 || strings.ContainsRune(validate+reload, 0) || health != nil && (len(*health) > 8192 || strings.ContainsRune(*health, 0)) {
		return errors.New("验证、reload 与健康检查命令各最多 8 KiB，不能含空字符")
	}
	key, err := a.fileHistoryKey(workspace, remote)
	if err != nil {
		return err
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	items, err := a.fileHistories()
	if err != nil {
		return err
	}
	configured := 0
	for _, item := range items {
		if !item.Automatic {
			configured++
		}
	}
	if item, exists := items[key]; (!exists || item.Automatic) && configured >= maxFileHistories {
		return errors.New("最多自定义 64 个文件的历史或操作设置，请先清除其他文件的设置")
	}
	item := items[key]
	item.Automatic = false
	item.Enabled = enabled
	item.Validate = validate
	item.Reload = reload
	if health != nil {
		item.HealthCheck = *health
	}
	items[key] = item
	data, err := json.Marshal(items)
	if err != nil {
		return err
	}
	return a.store.SetSecretSetting("file_histories", string(data))
}
func (a *AppService) ClearFileHistory(workspace, remote string) error {
	key, err := a.fileHistoryKey(workspace, remote)
	if err != nil {
		return err
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	items, err := a.fileHistories()
	if err != nil {
		return err
	}
	removed := []string{}
	for _, version := range items[key].Versions {
		removed = append(removed, "file_version:"+version.ID)
	}
	delete(items, key)
	data, err := json.Marshal(items)
	if err != nil {
		return err
	}
	return a.store.UpdateSecretSettings(map[string]string{"file_histories": string(data)}, removed)
}
func (a *AppService) recordFileVersion(workspace string, document files.Document) error {
	key, err := a.fileHistoryKey(workspace, document.Path)
	if err != nil {
		return err
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	items, err := a.fileHistories()
	if err != nil {
		return err
	}
	item, exists := items[key]
	if !exists {
		item = storedFileHistory{FileHistory: FileHistory{Enabled: true}, Automatic: true}
	}
	if !item.Enabled {
		return nil
	}
	if len(item.Versions) > 0 && item.Versions[len(item.Versions)-1].Revision == document.Revision {
		return nil
	}
	data, err := json.Marshal(document)
	if err != nil {
		return err
	}
	if len(data) > 4*files.MaxEditSize {
		return errors.New("配置历史单版本超过大小限制")
	}
	version := FileVersion{ID: base64.RawURLEncoding.EncodeToString(randomBytes(16)), Time: time.Now().UTC(), Size: len(data), Revision: document.Revision}
	item.Versions = append(item.Versions, version)
	items[key] = item
	removed := []string{}
	for {
		total := 0
		count := 0
		oldestKey := ""
		var oldest time.Time
		for id, history := range items {
			if len(history.Versions) > 0 {
				count++
			}
			for _, v := range history.Versions {
				total += v.Size
			}
			if len(history.Versions) > 0 && (oldestKey == "" || history.Versions[0].Time.Before(oldest)) {
				oldestKey = id
				oldest = history.Versions[0].Time
			}
		}
		if len(items[key].Versions) <= 10 && total <= fileHistoryLimit && count <= maxFileHistories {
			break
		}
		if len(items[key].Versions) > 10 {
			oldestKey = key
		}
		history := items[oldestKey]
		removed = append(removed, "file_version:"+history.Versions[0].ID)
		history.Versions = history.Versions[1:]
		if history.Automatic && len(history.Versions) == 0 {
			delete(items, oldestKey)
		} else {
			items[oldestKey] = history
		}
	}
	index, err := json.Marshal(items)
	if err != nil {
		return err
	}
	return a.store.UpdateSecretSettings(map[string]string{"file_histories": string(index), "file_version:" + version.ID: string(data)}, removed)
}
func (a *AppService) ReadFileVersion(workspace, remote, versionID string) (files.Document, error) {
	key, err := a.fileHistoryKey(workspace, remote)
	if err != nil {
		return files.Document{}, err
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	items, err := a.fileHistories()
	if err != nil {
		return files.Document{}, err
	}
	for _, version := range items[key].Versions {
		if version.ID == versionID {
			value, err := a.store.SecretSetting("file_version:" + versionID)
			if err != nil {
				return files.Document{}, err
			}
			var document files.Document
			if err := json.Unmarshal([]byte(value), &document); err != nil {
				return files.Document{}, err
			}
			return document, nil
		}
	}
	return files.Document{}, errors.New("配置历史版本不存在或已淘汰")
}
func (a *AppService) RunFileAction(ctx context.Context, workspace, remote, action, expectedScript string) (terminal.CommandResult, error) {
	if action == "reload" {
		if err := a.requireFileWrite(workspace); err != nil {
			return terminal.CommandResult{}, err
		}
	}
	history, err := a.GetFileHistory(workspace, remote)
	if err != nil {
		return terminal.CommandResult{}, err
	}
	script := history.Validate
	if action == "reload" {
		script = history.Reload
	} else if action == "health" {
		script = history.HealthCheck
	} else if action != "validate" {
		return terminal.CommandResult{}, errors.New("文件操作类型无效")
	}
	if strings.TrimSpace(script) == "" {
		return terminal.CommandResult{}, errors.New("尚未设置此文件的操作命令")
	}
	if script != expectedScript {
		return terminal.CommandResult{}, errors.New("操作命令已变化，请重新读取设置并确认")
	}
	return a.RunRemoteCommand(ctx, workspace, "export TERMQUAY_FILE="+sudoQuote(remote)+"\n"+script, 60)
}
