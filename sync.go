package main

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	files "github.com/Sanjeever/termquay/internal/files"
	"github.com/pkg/sftp"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type DirectorySyncPreview struct {
	ID        string            `json:"id"`
	Direction string            `json:"direction"`
	Local     string            `json:"local"`
	Remote    string            `json:"remote"`
	Entries   []files.SyncEntry `json:"entries"`
}
type directorySyncPlan struct {
	preview        DirectorySyncPreview
	workspace      string
	source, target map[string]files.SyncNode
	expires        time.Time
	executing      bool
}

func (a *AppService) PreviewDirectorySync(ctx context.Context, workspace, direction, local, remote string) (DirectorySyncPreview, error) {
	if local == "" {
		var err error
		local, err = application.Get().Dialog.OpenFile().SetTitle("选择本地同步目录").CanChooseFiles(false).CanChooseDirectories(true).PromptForSingleSelection()
		if err != nil || local == "" {
			return DirectorySyncPreview{}, err
		}
	}
	if !filepath.IsAbs(local) || len(local) > 4096 {
		return DirectorySyncPreview{}, errors.New("本地同步目录必须是绝对路径")
	}
	return a.previewDirectorySync(ctx, workspace, direction, local, remote)
}
func (a *AppService) previewDirectorySync(ctx context.Context, workspace, direction, local, remote string) (DirectorySyncPreview, error) {
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	if direction != "upload" && direction != "download" {
		return DirectorySyncPreview{}, errors.New("同步方向无效")
	}
	a.mu.Lock()
	for id, p := range a.syncPlans {
		if !p.executing && time.Now().After(p.expires) {
			delete(a.syncPlans, id)
		}
	}
	if a.workspaces[workspace] == nil || a.closed || len(a.syncPlans)+a.syncOpening >= 4 {
		a.mu.Unlock()
		return DirectorySyncPreview{}, errors.New("工作区已关闭或同步计划达到上限（4 个）")
	}
	a.syncOpening++
	ownerContext := a.workspaces[workspace].ctx
	a.mu.Unlock()
	stopOwner := context.AfterFunc(ownerContext, cancel)
	defer stopOwner()
	defer func() { a.mu.Lock(); a.syncOpening--; a.mu.Unlock() }()
	local, localNodes, err := files.ScanLocalSync(ctx, local)
	if err != nil {
		return DirectorySyncPreview{}, err
	}
	select {
	case a.fileSlots <- struct{}{}:
	case <-ctx.Done():
		return DirectorySyncPreview{}, ctx.Err()
	}
	defer func() { <-a.fileSlots }()
	owner, err := a.terminal(workspace)
	if err != nil {
		return DirectorySyncPreview{}, err
	}
	client, err := owner.DirectoryClient(ctx)
	if err != nil {
		return DirectorySyncPreview{}, err
	}
	defer client.Close()
	stop := context.AfterFunc(ctx, func() { client.Close() })
	defer stop()
	remote, remoteNodes, err := files.ScanRemoteSync(ctx, client, remote)
	if err != nil {
		return DirectorySyncPreview{}, err
	}
	source, target := localNodes, remoteNodes
	if direction == "download" {
		source, target = remoteNodes, localNodes
	}
	preview := DirectorySyncPreview{ID: base64.RawURLEncoding.EncodeToString(randomBytes(18)), Direction: direction, Local: local, Remote: remote, Entries: files.CompareSync(source, target)}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.workspaces[workspace] == nil || ctx.Err() != nil {
		return DirectorySyncPreview{}, errors.New("同步扫描已取消或工作区已关闭")
	}
	a.syncPlans[preview.ID] = &directorySyncPlan{preview: preview, workspace: workspace, source: source, target: target, expires: time.Now().Add(10 * time.Minute)}
	return preview, nil
}
func (a *AppService) CancelDirectorySyncPreview(id string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if p := a.syncPlans[id]; p != nil && !p.executing {
		delete(a.syncPlans, id)
	}
}
func (a *AppService) ExecuteDirectorySync(id string, selected []string) (Transfer, error) {
	a.mu.Lock()
	p := a.syncPlans[id]
	if p == nil || p.executing || time.Now().After(p.expires) || len(selected) == 0 || len(selected) > files.MaxSyncEntries {
		a.mu.Unlock()
		return Transfer{}, errors.New("同步预览已失效或选择无效")
	}
	chosen := map[string]bool{}
	for _, name := range selected {
		node, ok := p.source[name]
		if !ok || !node.Supported() {
			a.mu.Unlock()
			return Transfer{}, errors.New("同步选择包含未知或不支持路径")
		}
		chosen[name] = true
		if node.Mode.IsDir() {
			for child := range p.source {
				if strings.HasPrefix(child, name+"/") {
					chosen[child] = true
				}
			}
		}
	}
	entries := []files.SyncEntry{}
	total := int64(0)
	for _, entry := range p.preview.Entries {
		if !chosen[entry.Path] {
			continue
		}
		if entry.State == "conflict" {
			a.mu.Unlock()
			return Transfer{}, errors.New("选择中存在符号链接、类型或特殊文件冲突")
		}
		if entry.State == "same" {
			continue
		}
		entries = append(entries, entry)
		if !entry.Directory {
			total += entry.Size
		}
	}
	if len(entries) == 0 {
		a.mu.Unlock()
		return Transfer{}, errors.New("所选路径没有可同步差异")
	}
	p.executing = true
	a.mu.Unlock()
	view, err := a.startTransfer(p.workspace, fmt.Sprintf("目录同步（%d 项）", len(entries)), p.preview.Direction, total, func(ctx context.Context, report func(int64, int64)) error {
		if time.Now().After(p.expires) {
			return errors.New("同步预览已过期，请重新预览")
		}
		completed := int64(0)
		for index, entry := range entries {
			if err := ctx.Err(); err != nil {
				return err
			}
			if err := a.syncEntry(ctx, p, entry, func(done, _ int64) { report(completed+done, total) }); err != nil {
				return fmt.Errorf("同步停止（%d/%d）%s: %w；请重新预览剩余差异", index, len(entries), entry.Path, err)
			}
			if !entry.Directory {
				completed += entry.Size
			}
			report(completed, total)
		}
		return nil
	}, transferSpec{workspace: p.workspace, direction: "sync", local: p.preview.Local, remote: p.preview.Remote, syncPlanID: id})
	if err != nil {
		a.mu.Lock()
		p.executing = false
		a.mu.Unlock()
	}
	return view, err
}
func (a *AppService) syncEntry(ctx context.Context, p *directorySyncPlan, entry files.SyncEntry, report func(int64, int64)) error {
	local := filepath.Join(p.preview.Local, filepath.FromSlash(entry.Path))
	remote := path.Join(p.preview.Remote, entry.Path)
	resolved, err := filepath.EvalSymlinks(p.preview.Local)
	if err != nil || resolved != p.preview.Local {
		return errors.New("本地同步根已变化")
	}
	c, closeClient, err := a.fileClient(ctx, p.workspace)
	if err != nil {
		return err
	}
	canonical, err := c.RealPath(p.preview.Remote)
	if err != nil || canonical != p.preview.Remote {
		closeClient()
		return errors.New("远端同步根已变化")
	}
	if err = files.CheckLocalSyncPath(p.preview.Local, entry.Path, false); err != nil && !(p.preview.Direction == "download" && os.IsNotExist(err)) {
		closeClient()
		return err
	}
	if err = checkRemoteSyncPath(c, p.preview.Remote, entry.Path, false); err != nil && !(p.preview.Direction == "upload" && os.IsNotExist(err)) {
		closeClient()
		return err
	}
	localInfo, localErr := os.Lstat(local)
	remoteInfo, remoteErr := c.Lstat(remote)
	sourceInfo, sourceErr, targetInfo, targetErr := localInfo, localErr, remoteInfo, remoteErr
	if p.preview.Direction == "download" {
		sourceInfo, sourceErr, targetInfo, targetErr = remoteInfo, remoteErr, localInfo, localErr
	}
	if sourceErr != nil {
		closeClient()
		return sourceErr
	}
	if !files.SameSyncNode(files.SyncInfo(sourceInfo), p.source[entry.Path]) {
		closeClient()
		return errors.New("源路径自预览后已变化")
	}
	old, exists := p.target[entry.Path]
	if exists {
		if targetErr != nil {
			closeClient()
			return targetErr
		}
		if !files.SameSyncNode(files.SyncInfo(targetInfo), old) {
			closeClient()
			return errors.New("目标自预览后已变化")
		}
	} else if !os.IsNotExist(targetErr) {
		closeClient()
		if targetErr != nil {
			return targetErr
		}
		return errors.New("目标自预览后已出现")
	}
	if p.preview.Direction == "upload" {
		err = checkRemoteSyncPath(c, p.preview.Remote, entry.Path, true)
	} else {
		err = files.CheckLocalSyncPath(p.preview.Local, entry.Path, true)
	}
	if err != nil {
		closeClient()
		return err
	}
	if entry.Directory {
		if p.preview.Direction == "upload" {
			err = c.Mkdir(remote)
		} else {
			err = os.Mkdir(local, 0700)
		}
		closeClient()
		return err
	}
	closeClient()
	if p.preview.Direction == "upload" {
		_, run, err := a.uploadOperation(p.workspace, local, remote, exists, transferExpectation{source: p.source[entry.Path], target: old, targetExists: exists})
		if err != nil {
			return err
		}
		return run(ctx, report)
	}
	run, err := a.downloadOperation(p.workspace, remote, local, exists, transferExpectation{source: p.source[entry.Path], target: old, targetExists: exists})
	if err != nil {
		return err
	}
	return run(ctx, report)
}
func checkRemoteSyncPath(c *sftp.Client, root, relative string, create bool) error {
	parts := strings.Split(relative, "/")
	current := root
	for _, part := range parts[:len(parts)-1] {
		current = path.Join(current, part)
		info, err := c.Lstat(current)
		if os.IsNotExist(err) && create {
			err = c.Mkdir(current)
			if err != nil {
				return err
			}
			info, err = c.Lstat(current)
		}
		if err != nil {
			return err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return errors.New("远端同步父路径不是普通目录")
		}
	}
	return nil
}
