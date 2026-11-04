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

type FileVersion struct {
	ID       string    `json:"id"`
	Time     time.Time `json:"time"`
	Size     int       `json:"size"`
	Revision string    `json:"revision"`
}
type FileHistory struct {
	Enabled  bool          `json:"enabled"`
	Validate string        `json:"validate"`
	Reload   string        `json:"reload"`
	Versions []FileVersion `json:"versions"`
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
func (a *AppService) fileHistories() (map[string]FileHistory, error) {
	if err := a.openStorage(); err != nil {
		return nil, err
	}
	value, err := a.store.SecretSetting("file_histories")
	if err != nil {
		return nil, err
	}
	items := map[string]FileHistory{}
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
	return items[key], err
}
func (a *AppService) SetFileHistory(workspace, remote string, enabled bool, validate, reload string) error {
	if len(validate) > 8192 || len(reload) > 8192 || strings.ContainsRune(validate+reload, 0) {
		return errors.New("验证与 reload 命令各最多 8 KiB，不能含空字符")
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
	if _, exists := items[key]; !exists && len(items) >= 64 {
		return errors.New("配置历史最多管理 64 个文件，请先清除此文件以外的历史设置")
	}
	item := items[key]
	item.Enabled = enabled
	item.Validate = validate
	item.Reload = reload
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
	item := items[key]
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
		oldestKey := ""
		var oldest time.Time
		for id, history := range items {
			for _, v := range history.Versions {
				total += v.Size
			}
			if len(history.Versions) > 0 && (oldestKey == "" || history.Versions[0].Time.Before(oldest)) {
				oldestKey = id
				oldest = history.Versions[0].Time
			}
		}
		if len(items[key].Versions) <= 10 && total <= fileHistoryLimit {
			break
		}
		if len(items[key].Versions) > 10 {
			oldestKey = key
		}
		history := items[oldestKey]
		removed = append(removed, "file_version:"+history.Versions[0].ID)
		history.Versions = history.Versions[1:]
		items[oldestKey] = history
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
	history, err := a.GetFileHistory(workspace, remote)
	if err != nil {
		return terminal.CommandResult{}, err
	}
	script := history.Validate
	if action == "reload" {
		script = history.Reload
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
