package app

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path"
	"slices"
	"strings"
	"time"

	"github.com/Sanjeever/termquay/internal/files"
	appmessage "github.com/Sanjeever/termquay/internal/message"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type FilePasteItem struct {
	Source string `json:"source"`
	Name   string `json:"name"`
	Exists bool   `json:"exists"`
}

type FilePasteChoice struct {
	Name   string `json:"name"`
	Action string `json:"action"`
}

func (a *AppService) PreviewClipboardPaste(ctx context.Context, workspace, directory string, names []string) (DirectorySyncPreview, error) {
	a.fileClipboardMu.Lock()
	text, _ := application.Get().Clipboard.Text()
	a.mu.Lock()
	clipboard := a.fileClipboard
	a.mu.Unlock()
	if clipboard == nil || clipboard.token != text {
		a.fileClipboardMu.Unlock()
		if strings.HasPrefix(text, "termquay://files/") || len(names) != 0 {
			return DirectorySyncPreview{}, appmessage.New("backend:fileClipboardExpiredCopyAgainFromTheSource", "文件剪贴板已失效，请在来源工作区重新复制")
		}
		return DirectorySyncPreview{}, a.PasteClipboardFiles(ctx, workspace, directory)
	}
	defer a.fileClipboardMu.Unlock()
	return a.previewFilePaste(ctx, clipboard, workspace, directory, names)
}

func (a *AppService) previewFilePaste(ctx context.Context, clipboard *remoteFileClipboard, workspace, directory string, names []string) (DirectorySyncPreview, error) {
	if err := a.requireFileWrite(workspace); err != nil {
		return DirectorySyncPreview{}, err
	}
	if err := validateRemotePaths(clipboard.paths); err != nil {
		return DirectorySyncPreview{}, err
	}
	if !path.IsAbs(directory) || path.Clean(directory) != directory || len(directory) > 4096 || strings.ContainsRune(directory, 0) || len(names) != 0 && len(names) != len(clipboard.paths) {
		return DirectorySyncPreview{}, appmessage.New("backend:invalidDirectoryPath", "目录路径无效")
	}
	a.mu.Lock()
	for id, plan := range a.syncPlans {
		if !plan.executing && time.Now().After(plan.expires) {
			delete(a.syncPlans, id)
		}
	}
	sourceOwner, targetOwner := a.workspaces[clipboard.workspace], a.workspaces[workspace]
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
	source, releaseSource, err := a.fileClient(ctx, clipboard.workspace)
	if err != nil {
		return DirectorySyncPreview{}, err
	}
	defer func() {
		if releaseSource != nil {
			releaseSource()
		}
	}()
	target, releaseTarget, err := a.fileClient(ctx, workspace)
	if err != nil {
		return DirectorySyncPreview{}, err
	}
	defer releaseTarget()
	directory, err = target.RealPath(directory)
	if err != nil {
		return DirectorySyncPreview{}, err
	}
	info, err := target.Lstat(directory)
	if err != nil {
		return DirectorySyncPreview{}, err
	}
	if !info.IsDir() {
		return DirectorySyncPreview{}, appmessage.New("backend:destinationMustBeADirectory", "目标必须是目录")
	}
	preview := DirectorySyncPreview{ID: base64.RawURLEncoding.EncodeToString(randomBytes(18)), Direction: "copy", Local: "/", Remote: directory}
	sources, targets := map[string]files.SyncNode{}, map[string]files.SyncNode{}
	paths := map[string]string{}
	used := map[string]bool{}
	pathBytes := 0
	for index, original := range clipboard.paths {
		if err := ctx.Err(); err != nil {
			return DirectorySyncPreview{}, err
		}
		parent, err := source.RealPath(path.Dir(original))
		if err != nil {
			return DirectorySyncPreview{}, err
		}
		original = path.Join(parent, path.Base(original))
		info, err := source.Lstat(original)
		if err != nil {
			return DirectorySyncPreview{}, err
		}
		name := path.Base(original)
		if len(names) != 0 {
			name = names[index]
		}
		if name == "" || name == "." || name == ".." || len(name) > 255 || strings.ContainsAny(name, "/\\\x00\r\n:") {
			return DirectorySyncPreview{}, appmessage.New("backend:invalidSelectedItemName", "所选项目名称无效")
		}
		sameServer := sourceOwner.target == targetOwner.target && sourceOwner.identity == targetOwner.identity
		if sameServer && original == path.Join(directory, name) && len(names) == 0 {
			ext := path.Ext(name)
			if info.IsDir() {
				ext = ""
			}
			base := strings.TrimSuffix(name, ext)
			for number := 1; ; number++ {
				name = base + " copy" + ext
				if number > 1 {
					name = fmt.Sprintf("%s copy %d%s", base, number, ext)
				}
				_, err := target.Lstat(path.Join(directory, name))
				if os.IsNotExist(err) && !used[name] {
					break
				}
				if err != nil && !os.IsNotExist(err) {
					return DirectorySyncPreview{}, err
				}
				if number >= 10000 {
					return DirectorySyncPreview{}, appmessage.New("backend:destinationAlreadyExistsAndWasNotOverwritten", "同名目标已存在，未覆盖")
				}
			}
		}
		if used[name] {
			return DirectorySyncPreview{}, appmessage.New("backend:duplicateCopyNames", "来源包含同名文件，请分批复制")
		}
		used[name] = true
		destination := path.Join(directory, name)
		if sameServer && (original == destination || info.IsDir() && (strings.HasPrefix(destination, original+"/") || strings.HasPrefix(original, destination+"/"))) {
			return DirectorySyncPreview{}, appmessage.New("backend:sourceAndDestinationDirectoriesOnTheSameRemote", "同一远端的来源与目标目录不能重叠")
		}
		_, targetErr := target.Lstat(destination)
		if targetErr != nil && !os.IsNotExist(targetErr) {
			return DirectorySyncPreview{}, targetErr
		}
		preview.PasteItems = append(preview.PasteItems, FilePasteItem{Source: original, Name: name, Exists: targetErr == nil})
		nodes := map[string]files.SyncNode{"": files.SyncInfo(info)}
		if info.IsDir() && info.Mode()&os.ModeSymlink == 0 {
			releaseSource()
			releaseSource = nil
			_, children, err := a.scanWorkspaceDirectory(ctx, clipboard.workspace, original, nil)
			if err != nil {
				return DirectorySyncPreview{}, err
			}
			for relative, node := range children {
				nodes[relative] = node
			}
			source, releaseSource, err = a.fileClient(ctx, clipboard.workspace)
			if err != nil {
				return DirectorySyncPreview{}, err
			}
		}
		relatives := make([]string, 0, len(nodes))
		for relative := range nodes {
			relatives = append(relatives, relative)
		}
		slices.Sort(relatives)
		for _, relative := range relatives {
			node := nodes[relative]
			key := path.Join(name, relative)
			pathBytes += len(key) + len(original) + len(relative)
			if len(sources) >= files.MaxSyncEntries || pathBytes > files.MaxSyncPathBytes || strings.Count(key, "/") >= files.MaxSyncDepth {
				return DirectorySyncPreview{}, appmessage.New("backend:syncPathInvalidOrScanLimitExceeded10000", "同步路径无效或超过扫描上限（10000 项、64 层、8 MiB 路径）")
			}
			sources[key], paths[key] = node, path.Join(original, relative)
			blocked := false
			for parent := path.Dir(key); parent != "."; parent = path.Dir(parent) {
				if old, exists := targets[parent]; exists && (!old.Supported() || !old.Mode.IsDir()) {
					blocked = true
					break
				}
			}
			if blocked {
				continue
			}
			if err := checkRemoteSyncPath(target, directory, key, false); err != nil {
				if os.IsNotExist(err) {
					continue
				}
				return DirectorySyncPreview{}, err
			}
			old, err := target.Lstat(path.Join(directory, key))
			if err == nil {
				targets[key] = files.SyncInfo(old)
			} else if !os.IsNotExist(err) {
				return DirectorySyncPreview{}, err
			}
		}
	}
	preview.Entries = files.CompareSync(sources, targets)
	blocked := map[string]bool{}
	for _, entry := range preview.Entries {
		if entry.State == "conflict" || sources[entry.Path].Mode&(os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != 0 {
			blocked[entry.Path] = true
		}
	}
	for index := range preview.Entries {
		entry := &preview.Entries[index]
		for parent := entry.Path; parent != "."; parent = path.Dir(parent) {
			if blocked[parent] {
				entry.State = "conflict"
				break
			}
		}
		if entry.State == "same" && !entry.Directory {
			entry.State = "update"
		}
		if entry.State == "conflict" {
			delete(sources, entry.Path)
		}
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if ctx.Err() != nil || a.workspaces[clipboard.workspace] != sourceOwner || a.workspaces[workspace] != targetOwner {
		return DirectorySyncPreview{}, appmessage.New("backend:scanCanceledOrConnectionChanged", "扫描已取消或连接已变化")
	}
	a.syncPlans[preview.ID] = &directorySyncPlan{preview: preview, workspace: workspace, sourceWorkspace: clipboard.workspace, source: sources, target: targets, pasteSources: paths, expires: time.Now().Add(10 * time.Minute)}
	return preview, nil
}

func (a *AppService) ExecuteFilePaste(id string, choices []FilePasteChoice) (Transfer, error) {
	a.mu.Lock()
	plan := a.syncPlans[id]
	if plan == nil || plan.pasteSources == nil || len(choices) != len(plan.preview.PasteItems) {
		a.mu.Unlock()
		return Transfer{}, appmessage.New("backend:copyPreviewExpired", "复制预览已失效")
	}
	selected := []string{}
	for index, item := range plan.preview.PasteItems {
		choice := choices[index]
		if choice.Name != item.Name || choice.Action != "copy" && choice.Action != "overwrite" && choice.Action != "skip" || choice.Action == "copy" && item.Exists {
			a.mu.Unlock()
			return Transfer{}, appmessage.New("backend:destinationAlreadyExistsAndWasNotOverwritten", "同名目标已存在，未覆盖")
		}
		if choice.Action != "skip" {
			selected = append(selected, item.Name)
		}
	}
	a.mu.Unlock()
	return a.ExecuteDirectorySync(id, selected)
}
