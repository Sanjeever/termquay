package app

import (
	"context"
	"encoding/base64"

	"os"
	"path"
	"strings"
	"time"

	"github.com/Sanjeever/termquay/internal/files"
	appmessage "github.com/Sanjeever/termquay/internal/message"
)

func (a *AppService) scanWorkspaceDirectory(ctx context.Context, workspace, root string, exclude []string) (string, map[string]files.SyncNode, error) {
	select {
	case a.fileSlots <- struct{}{}:
	case <-ctx.Done():
		return "", nil, ctx.Err()
	}
	defer func() { <-a.fileSlots }()
	owner, err := a.terminal(workspace)
	if err != nil {
		return "", nil, err
	}
	client, err := owner.DirectoryClient(ctx)
	if err != nil {
		return "", nil, err
	}
	defer client.Close()
	stop := context.AfterFunc(ctx, func() { client.Close() })
	defer stop()
	return files.ScanRemoteSync(ctx, client, root, exclude...)
}

func (a *AppService) PreviewRemoteDirectoryCopy(ctx context.Context, sourceID, sourcePath, targetID, targetPath string, exclude []string) (DirectorySyncPreview, error) {
	if err := files.ValidateSyncExcludes(exclude); err != nil {
		return DirectorySyncPreview{}, err
	}
	if !path.IsAbs(sourcePath) || !path.IsAbs(targetPath) || len(sourcePath) > 4096 || len(targetPath) > 4096 {
		return DirectorySyncPreview{}, appmessage.New("backend:directoryMustBeAnAbsoluteRemotePath", "目录必须是远端绝对路径")
	}
	a.mu.Lock()
	for id, plan := range a.syncPlans {
		if !plan.executing && time.Now().After(plan.expires) {
			delete(a.syncPlans, id)
		}
	}
	sourceOwner, targetOwner := a.workspaces[sourceID], a.workspaces[targetID]
	if sourceOwner == nil || targetOwner == nil || a.closed || len(a.syncPlans)+a.syncOpening >= 4 {
		a.mu.Unlock()
		return DirectorySyncPreview{}, appmessage.New("backend:workspaceClosedOrSyncPlanLimitReached4", "工作区已关闭或同步计划达到上限（4 个）")
	}
	a.syncOpening++
	a.mu.Unlock()
	defer func() { a.mu.Lock(); a.syncOpening--; a.mu.Unlock() }()
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	stopSource := context.AfterFunc(sourceOwner.ctx, cancel)
	defer stopSource()
	stopTarget := context.AfterFunc(targetOwner.ctx, cancel)
	defer stopTarget()
	sourcePath, source, err := a.scanWorkspaceDirectory(ctx, sourceID, sourcePath, exclude)
	if err != nil {
		return DirectorySyncPreview{}, err
	}
	targetPath, target, err := a.scanWorkspaceDirectory(ctx, targetID, targetPath, exclude)
	if err != nil {
		return DirectorySyncPreview{}, err
	}
	if sourceOwner.target == targetOwner.target && sourceOwner.identity == targetOwner.identity && (sourcePath == targetPath || strings.HasPrefix(targetPath, strings.TrimSuffix(sourcePath, "/")+"/") || strings.HasPrefix(sourcePath, strings.TrimSuffix(targetPath, "/")+"/")) {
		return DirectorySyncPreview{}, appmessage.New("backend:sourceAndDestinationDirectoriesOnTheSameRemote", "同一远端的来源与目标目录不能重叠")
	}
	preview := DirectorySyncPreview{ID: base64.RawURLEncoding.EncodeToString(randomBytes(18)), Direction: "copy", Local: sourcePath, Remote: targetPath, Entries: files.CompareSync(source, target), Exclude: exclude}
	a.mu.Lock()
	defer a.mu.Unlock()
	if ctx.Err() != nil || a.workspaces[sourceID] != sourceOwner || a.workspaces[targetID] != targetOwner {
		return DirectorySyncPreview{}, appmessage.New("backend:scanCanceledOrConnectionChanged", "扫描已取消或连接已变化")
	}
	a.syncPlans[preview.ID] = &directorySyncPlan{preview: preview, workspace: targetID, sourceWorkspace: sourceID, source: source, target: target, expires: time.Now().Add(10 * time.Minute)}
	return preview, nil
}

func (a *AppService) remoteSyncEntry(ctx context.Context, plan *directorySyncPlan, entry files.SyncEntry, report func(int64, int64)) error {
	sourceOwner, err := a.terminal(plan.sourceWorkspace)
	if err != nil {
		return err
	}
	targetOwner, err := a.terminal(plan.workspace)
	if err != nil {
		return err
	}
	source, releaseSource, err := a.fileClient(ctx, plan.sourceWorkspace)
	if err != nil {
		return err
	}
	sourceRoot, err := source.RealPath(plan.preview.Local)
	if err == nil && sourceRoot != plan.preview.Local {
		err = appmessage.New("backend:sourceRootDirectoryChanged", "来源根目录已变化")
	}
	if err == nil {
		err = checkRemoteSyncPath(source, sourceRoot, entry.Path, false)
	}
	if err != nil {
		releaseSource()
		return err
	}
	sourcePath := path.Join(sourceRoot, entry.Path)
	info, err := source.Lstat(sourcePath)
	releaseSource()
	if err != nil {
		return err
	}
	if !files.SameSyncNode(files.SyncInfo(info), plan.source[entry.Path]) {
		return appmessage.New("backend:sourceChangedAfterPreview", "来源自预览后已变化")
	}
	target, releaseTarget, err := a.fileWriteClient(ctx, plan.workspace)
	if err != nil {
		return err
	}
	targetRoot, err := target.RealPath(plan.preview.Remote)
	if err == nil && targetRoot != plan.preview.Remote {
		err = appmessage.New("backend:destinationRootDirectoryChanged", "目标根目录已变化")
	}
	if err == nil {
		err = checkRemoteSyncPath(target, targetRoot, entry.Path, true)
	}
	if err != nil {
		releaseTarget()
		return err
	}
	targetPath := path.Join(targetRoot, entry.Path)
	previous, statErr := target.Lstat(targetPath)
	old, exists := plan.target[entry.Path]
	if exists && (statErr != nil || !files.SameSyncNode(files.SyncInfo(previous), old)) || !exists && !os.IsNotExist(statErr) {
		releaseTarget()
		return appmessage.New("backend:destinationChangedAfterPreviewOrCannotBeVerified", "目标自预览后已变化或无法核对")
	}
	if entry.Directory {
		err = target.Mkdir(targetPath)
		releaseTarget()
		return err
	}
	releaseTarget()
	expected := transferExpectation{source: plan.source[entry.Path], target: old, targetExists: exists}
	return a.remoteCopyOperation(plan.sourceWorkspace, sourcePath, plan.workspace, targetPath, exists, false, sourceOwner, targetOwner, info, &expected)(ctx, report)
}
