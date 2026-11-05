package app

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
)

type savedTransferFile struct {
	Length    int64       `json:"length"`
	Modified  time.Time   `json:"modified"`
	ModeValue os.FileMode `json:"mode"`
	LocalID   string      `json:"local_id,omitempty"`
}

func (f *savedTransferFile) Name() string       { return "" }
func (f *savedTransferFile) Size() int64        { return f.Length }
func (f *savedTransferFile) ModTime() time.Time { return f.Modified }
func (f *savedTransferFile) Mode() os.FileMode  { return f.ModeValue }
func (f *savedTransferFile) IsDir() bool        { return f.ModeValue.IsDir() }
func (f *savedTransferFile) Sys() any           { return nil }

type savedTransferResume struct {
	View      Transfer           `json:"view"`
	Identity  string             `json:"identity"`
	Local     string             `json:"local"`
	Remote    string             `json:"remote"`
	Temporary string             `json:"temporary"`
	Staging   string             `json:"staging,omitempty"`
	Offset    int64              `json:"offset"`
	Source    *savedTransferFile `json:"source"`
	Before    *savedTransferFile `json:"before,omitempty"`
	Partial   *savedTransferFile `json:"partial,omitempty"`
}

func saveTransferFile(info os.FileInfo, local string) (*savedTransferFile, error) {
	if info == nil {
		return nil, nil
	}
	if saved, ok := info.(*savedTransferFile); ok {
		return saved, nil
	}
	file := &savedTransferFile{Length: info.Size(), Modified: info.ModTime(), ModeValue: info.Mode()}
	if local != "" {
		var err error
		file.LocalID, err = transferFileID(info, local)
		if err != nil {
			return nil, err
		}
	}
	return file, nil
}

func restoreLocalTransferFile(expected os.FileInfo, filename string) (os.FileInfo, error) {
	saved, ok := expected.(*savedTransferFile)
	if !ok {
		return expected, nil
	}
	current, err := os.Lstat(filename)
	if err != nil {
		return nil, err
	}
	identity, err := transferFileID(current, filename)
	if err != nil {
		return nil, err
	}
	if identity != saved.LocalID || !sameTransferVersion(saved, current, false) {
		return nil, errors.New("本地文件身份或版本自中断后已变化")
	}
	return current, nil
}

func validateSavedTransfer(item savedTransferResume) error {
	if !validWorkspaceID(item.View.ID) || item.Source == nil || !item.Source.Mode().IsRegular() || item.Offset <= 0 || item.Offset > item.Source.Size() || len(item.Identity) > 4096 || item.Identity == "" || len(item.View.Target) > 1024 || !filepath.IsAbs(item.Local) || filepath.Clean(item.Local) != item.Local || len(item.Local) > 4096 {
		return errors.New("续传记录的身份、文件版本或进度无效")
	}
	if err := validateRemotePaths([]string{item.Remote}); err != nil {
		return err
	}
	if item.View.Direction == "upload" {
		token := strings.TrimPrefix(path.Base(item.Staging), ".termquay-")
		if _, err := hex.DecodeString(token); err != nil || len(token) != 32 || path.Dir(item.Staging) != path.Dir(item.Remote) || item.Temporary != path.Join(item.Staging, "data") || item.Source.LocalID == "" {
			return errors.New("上传续传暂存路径或源文件身份无效")
		}
	} else if item.View.Direction == "download" {
		if filepath.Dir(item.Temporary) != filepath.Dir(item.Local) || !strings.HasPrefix(filepath.Base(item.Temporary), ".termquay-download-") || item.Partial == nil || item.Partial.LocalID == "" || item.Partial.Length != item.Offset || item.Before != nil && item.Before.LocalID == "" {
			return errors.New("下载续传暂存路径或文件身份无效")
		}
	} else {
		return errors.New("续传记录的传输方向无效")
	}
	return nil
}

func (a *AppService) loadTransferResumesLocked() error {
	a.mu.Lock()
	loaded := a.transferResumesLoaded
	a.mu.Unlock()
	if loaded {
		return nil
	}
	value, err := a.store.SecretSetting("transfer_resumes")
	if err != nil {
		return err
	}
	var saved struct {
		Version int                   `json:"version"`
		Items   []savedTransferResume `json:"items"`
	}
	if value != "" {
		if len(value) > 1<<20 {
			return errors.New("续传记录超过 1 MiB")
		}
		if err := decodeWorkflow(value, &saved); err != nil {
			return err
		}
		if saved.Version != 1 || len(saved.Items) > 100 {
			return errors.New("续传记录版本未知或数量超限")
		}
	}
	seen := map[string]bool{}
	for _, item := range saved.Items {
		if err := validateSavedTransfer(item); err != nil {
			return err
		}
		if seen[item.View.ID] {
			return errors.New("续传记录标识重复")
		}
		seen[item.View.ID] = true
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.transfers)+len(saved.Items) > 100 {
		return errors.New("传输记录超过 100 项，请先清理已结束任务")
	}
	for _, item := range saved.Items {
		if a.transfers[item.View.ID] != nil {
			return errors.New("续传记录与当前任务标识冲突")
		}
	}
	for _, item := range saved.Items {
		view := item.View
		a.transferSequence++
		view.Sequence, view.Workspace, view.State, view.Phase = a.transferSequence, "", "cancelled", ""
		view.Completed, view.Total, view.Speed, view.RemainingSeconds = item.Offset, item.Source.Size(), 0, -1
		view.Retryable, view.Resumable, view.ResumePersisted = false, true, true
		view.TemporaryPath = item.Temporary
		view.Error = "上次传输已中断，请重新连接同一目标后显式续传"
		var before os.FileInfo
		if item.Before != nil {
			before = item.Before
		}
		state := &transferResume{source: item.Source, before: before, offset: item.Offset, temporary: item.Temporary, staging: item.Staging, partial: item.Partial}
		done := make(chan struct{})
		close(done)
		a.transfers[view.ID] = &transferTask{view: view, cancel: func() {}, done: done, peerIdentity: item.Identity, resume: state, spec: &transferSpec{local: item.Local, remote: item.Remote, direction: view.Direction}}
	}
	a.transferResumesLoaded = true
	return nil
}

func (a *AppService) RestoreTransferResumes() error {
	a.transferPersistenceMu.Lock()
	defer a.transferPersistenceMu.Unlock()
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return err
	}
	return a.loadTransferResumesLocked()
}

func (a *AppService) persistTransferResumes() error {
	a.transferPersistenceMu.Lock()
	defer a.transferPersistenceMu.Unlock()
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if a.store == nil || a.sessionDir != "" {
		return nil
	}
	if err := a.loadTransferResumesLocked(); err != nil {
		return err
	}
	type pending struct {
		view     Transfer
		identity string
		spec     transferSpec
		state    transferResume
	}
	a.mu.Lock()
	items := []pending{}
	for _, task := range a.transfers {
		if task.resume != nil && task.spec != nil && !task.resumeClaimed && task.view.State != "running" && task.view.State != "queued" {
			items = append(items, pending{task.view, task.peerIdentity, *task.spec, *task.resume})
		}
	}
	a.mu.Unlock()
	output := []savedTransferResume{}
	for _, item := range items {
		sourceLocal, targetLocal := "", ""
		if item.spec.direction == "upload" {
			sourceLocal = item.spec.local
		} else {
			targetLocal = item.spec.local
		}
		source, err := saveTransferFile(item.state.source, sourceLocal)
		if err != nil {
			return err
		}
		before, err := saveTransferFile(item.state.before, targetLocal)
		if err != nil {
			return err
		}
		partial := item.state.partial
		if item.spec.direction == "download" && partial == nil {
			info, err := os.Lstat(item.state.temporary)
			if err != nil {
				return err
			}
			partial, err = saveTransferFile(info, item.state.temporary)
			if err != nil {
				return err
			}
		}
		record := savedTransferResume{View: item.view, Identity: item.identity, Local: item.spec.local, Remote: item.spec.remote, Temporary: item.state.temporary, Staging: item.state.staging, Offset: item.state.offset, Source: source, Before: before, Partial: partial}
		if err := validateSavedTransfer(record); err != nil {
			return err
		}
		output = append(output, record)
	}
	value, err := json.Marshal(struct {
		Version int                   `json:"version"`
		Items   []savedTransferResume `json:"items"`
	}{1, output})
	if err != nil {
		return err
	}
	if len(value) > 1<<20 {
		return errors.New("续传记录超过 1 MiB")
	}
	if err := a.store.UpdateSecretSettings(map[string]string{"transfer_resumes": string(value)}, nil); err != nil {
		return err
	}
	a.mu.Lock()
	for _, item := range items {
		if task := a.transfers[item.view.ID]; task != nil && task.resume != nil {
			task.view.ResumePersisted = true
			a.transferEvent(task.view)
		}
	}
	a.mu.Unlock()
	return nil
}
