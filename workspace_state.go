package main

import (
	"encoding/json"
	"errors"
	"path"
	"strings"
	"time"
	"unicode/utf8"
)

const maxRecoveryDocuments = 64
const maxRecoveryDocumentBytes = 2 << 20
const maxRecoveryBytes = 8 << 20
const recoveryRetention = 7 * 24 * time.Hour

type RecoveryDraft struct {
	Workspace     string    `json:"workspace"`
	WorkspaceName string    `json:"workspace_name,omitempty"`
	Path          string    `json:"path"`
	Content       string    `json:"content"`
	Encoding      string    `json:"encoding,omitempty"`
	LineEnding    string    `json:"line_ending,omitempty"`
	BOM           bool      `json:"bom,omitempty"`
	UpdatedAt     time.Time `json:"updated_at"`
}
type RecoveryDraftInput struct {
	Path       string `json:"path"`
	Content    string `json:"content"`
	Encoding   string `json:"encoding,omitempty"`
	LineEnding string `json:"line_ending,omitempty"`
	BOM        bool   `json:"bom,omitempty"`
}
type RecoveryDraftSummary struct {
	Workspace     string    `json:"workspace"`
	WorkspaceName string    `json:"workspace_name,omitempty"`
	Path          string    `json:"path"`
	Bytes         int       `json:"bytes"`
	UpdatedAt     time.Time `json:"updated_at"`
}
type DraftRecoveryState struct {
	Enabled     bool                   `json:"enabled"`
	SessionOnly bool                   `json:"session_only"`
	Drafts      []RecoveryDraftSummary `json:"drafts"`
}
type recoveryData struct {
	Version int             `json:"version"`
	Enabled bool            `json:"enabled"`
	Drafts  []RecoveryDraft `json:"drafts"`
}

func validWorkspaceID(id string) bool {
	return id != "" && len(id) <= 64 && strings.IndexFunc(id, func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_' || r == '-')
	}) < 0
}
func (a *AppService) recoveryData() (recoveryData, error) {
	result := recoveryData{Version: 1, Drafts: []RecoveryDraft{}}
	if err := a.openStorage(); err != nil {
		return result, err
	}
	value, err := a.store.SecretSetting("workspace_drafts")
	if err != nil || value == "" {
		return result, err
	}
	if len(value) > 16<<20 {
		return result, errors.New("本地草稿编码超过 16 MiB 上限")
	}
	decoder := json.NewDecoder(strings.NewReader(value))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&result); err != nil {
		return result, err
	}
	if result.Version != 1 && result.Version != 2 {
		return result, errors.New("本地草稿版本不受支持")
	}
	next := result.Drafts[:0]
	for _, d := range result.Drafts {
		if !d.UpdatedAt.Before(time.Now().Add(-recoveryRetention)) {
			next = append(next, d)
		}
	}
	if len(next) != len(result.Drafts) {
		result.Drafts = next
		if err = a.writeRecoveryData(result); err != nil {
			return result, err
		}
	}
	return result, nil
}
func (a *AppService) writeRecoveryData(value recoveryData) error {
	value.Version = 2
	if len(value.Drafts) > maxRecoveryDocuments {
		return errors.New("本地草稿超过 64 个文档上限")
	}
	total := 0
	for _, d := range value.Drafts {
		if len(d.Content) > maxRecoveryDocumentBytes {
			return errors.New("本地单份草稿超过 2 MiB 上限")
		}
		total += len(d.Content)
	}
	if total > maxRecoveryBytes {
		return errors.New("本地草稿总量超过 8 MiB 上限")
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if len(encoded) > 16<<20 {
		return errors.New("本地草稿编码超过 16 MiB 上限")
	}
	return a.store.SetSecretSetting("workspace_drafts", string(encoded))
}
func (a *AppService) GetDraftRecoveryState() (DraftRecoveryState, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	value, err := a.recoveryData()
	if err != nil {
		return DraftRecoveryState{}, err
	}
	result := DraftRecoveryState{Enabled: value.Enabled, SessionOnly: a.sessionDir != "", Drafts: []RecoveryDraftSummary{}}
	for _, d := range value.Drafts {
		result.Drafts = append(result.Drafts, RecoveryDraftSummary{Workspace: d.Workspace, WorkspaceName: d.WorkspaceName, Path: d.Path, Bytes: len(d.Content), UpdatedAt: d.UpdatedAt})
	}
	return result, nil
}
func (a *AppService) SetDraftRecoveryEnabled(enabled bool) error {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	value, err := a.recoveryData()
	if err != nil {
		return err
	}
	value.Enabled = enabled
	if !enabled {
		value.Drafts = []RecoveryDraft{}
	}
	return a.writeRecoveryData(value)
}
func (a *AppService) SaveWorkspaceDrafts(workspace string, documents []RecoveryDraftInput) error {
	return a.SaveRecoveryDrafts([]WorkspaceDraftUpdate{{Workspace: workspace, Documents: documents}})
}

type WorkspaceDraftUpdate struct {
	Workspace string               `json:"workspace"`
	Name      string               `json:"name"`
	Documents []RecoveryDraftInput `json:"documents"`
}

func (a *AppService) SaveRecoveryDrafts(updates []WorkspaceDraftUpdate) error {
	if len(updates) > 128 {
		return errors.New("草稿更新工作区过多")
	}
	seenWorkspaces := map[string]bool{}
	inputBytes, inputDocuments := 0, 0
	for _, update := range updates {
		if !validWorkspaceID(update.Workspace) || len(update.Name) > 256 || seenWorkspaces[update.Workspace] {
			return errors.New("草稿工作区无效或重复")
		}
		seenWorkspaces[update.Workspace] = true
		a.mu.Lock()
		registered := a.views[update.Workspace]
		a.mu.Unlock()
		if len(update.Documents) > 0 && !registered {
			return errors.New("草稿所属界面工作区已关闭")
		}
		seen := map[string]bool{}
		for _, d := range update.Documents {
			if !path.IsAbs(d.Path) || path.Clean(d.Path) != d.Path || len(d.Path) > 4096 || seen[d.Path] || !utf8.ValidString(d.Content) || len(d.Content) > maxRecoveryDocumentBytes {
				return errors.New("草稿路径、编码、重复项或正文大小无效")
			}
			seen[d.Path] = true
			inputBytes += len(d.Content)
			inputDocuments++
		}
	}
	if inputBytes > maxRecoveryBytes || inputDocuments > maxRecoveryDocuments {
		return errors.New("本地草稿超过 64 份或 8 MiB 总量上限")
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	value, err := a.recoveryData()
	if err != nil {
		return err
	}
	if !value.Enabled {
		if inputDocuments == 0 {
			return nil
		}
		return errors.New("尚未启用加密本地草稿恢复")
	}
	next := make([]RecoveryDraft, 0, len(value.Drafts)+inputDocuments)
	for _, d := range value.Drafts {
		if !seenWorkspaces[d.Workspace] {
			next = append(next, d)
		}
	}
	now := time.Now().UTC()
	for _, update := range updates {
		for _, d := range update.Documents {
			next = append(next, RecoveryDraft{Workspace: update.Workspace, WorkspaceName: update.Name, Path: d.Path, Content: d.Content, Encoding: d.Encoding, LineEnding: d.LineEnding, BOM: d.BOM, UpdatedAt: now})
		}
	}
	value.Drafts = next
	return a.writeRecoveryData(value)
}
func (a *AppService) ReadRecoveryDraft(workspace, remote string) (RecoveryDraft, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	value, err := a.recoveryData()
	if err != nil {
		return RecoveryDraft{}, err
	}
	for _, d := range value.Drafts {
		if d.Workspace == workspace && d.Path == remote {
			return d, nil
		}
	}
	return RecoveryDraft{}, errors.New("本地草稿不存在或已过期")
}
func (a *AppService) WorkspaceRecoveryDrafts(workspace string) ([]RecoveryDraft, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	value, err := a.recoveryData()
	if err != nil {
		return nil, err
	}
	result := []RecoveryDraft{}
	for _, d := range value.Drafts {
		if d.Workspace == workspace {
			result = append(result, d)
		}
	}
	return result, nil
}
func (a *AppService) ClearRecoveryDrafts() error {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	value, err := a.recoveryData()
	if err != nil {
		return err
	}
	value.Drafts = []RecoveryDraft{}
	return a.writeRecoveryData(value)
}
