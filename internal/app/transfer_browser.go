package app

import (
	"context"
	"errors"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/Sanjeever/termquay/internal/files"
	appmessage "github.com/Sanjeever/termquay/internal/message"
)

type TransferDirectory struct {
	Path      string        `json:"path"`
	Parent    string        `json:"parent"`
	Entries   []files.Entry `json:"entries"`
	Truncated bool          `json:"truncated"`
}

func (a *AppService) BrowseTransferDirectory(ctx context.Context, workspace, directory string) (TransferDirectory, error) {
	view := TransferDirectory{Entries: []files.Entry{}}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if len(directory) > 4096 || strings.ContainsRune(directory, 0) {
		return view, appmessage.New("backend:invalidDirectoryPath", "目录路径无效")
	}
	var read func() ([]os.FileInfo, error)
	join := path.Join
	if workspace == "" {
		if directory == "" {
			var err error
			directory, err = os.UserHomeDir()
			if err != nil {
				return view, err
			}
		}
		if !filepath.IsAbs(directory) {
			return view, appmessage.New("backend:localDirectoryMustBeAnAbsolutePath", "本地目录必须是绝对路径")
		}
		directory = filepath.Clean(directory)
		file, err := os.Open(directory)
		if err != nil {
			return view, err
		}
		defer file.Close()
		read = func() ([]os.FileInfo, error) { return file.Readdir(128) }
		join = filepath.Join
		view.Parent = filepath.Dir(directory)
	} else {
		select {
		case a.fileSlots <- struct{}{}:
		case <-ctx.Done():
			return view, ctx.Err()
		}
		defer func() { <-a.fileSlots }()
		a.mu.Lock()
		owner := a.workspaces[workspace]
		a.mu.Unlock()
		if owner == nil {
			return view, appmessage.New("backend:sSHWorkspaceClosed", "SSH 工作区已关闭")
		}
		stopOwner := context.AfterFunc(owner.ctx, cancel)
		defer stopOwner()
		client, err := owner.terminal.DirectoryClient(ctx)
		if err != nil {
			return view, err
		}
		defer client.Close()
		stop := context.AfterFunc(ctx, func() { client.Close() })
		defer stop()
		if directory == "" {
			directory = "."
		}
		directory, err = client.RealPath(directory)
		if err != nil {
			return view, err
		}
		file, err := client.OpenDir(directory)
		if err != nil {
			return view, err
		}
		defer file.Close()
		read = func() ([]os.FileInfo, error) { return file.ReaddirContext(ctx, 128) }
		view.Parent = path.Dir(directory)
	}
	view.Path = directory
	for {
		if err := ctx.Err(); err != nil {
			return view, err
		}
		items, err := read()
		for _, item := range items {
			if item.Name() == "." || item.Name() == ".." {
				continue
			}
			if len(view.Entries) == 512 {
				view.Truncated = true
				break
			}
			view.Entries = append(view.Entries, files.Entry{Name: item.Name(), Path: join(directory, item.Name()), Directory: item.IsDir(), Size: item.Size(), Symlink: item.Mode()&os.ModeSymlink != 0, Mode: item.Mode().String(), Modified: item.ModTime().UnixMilli()})
		}
		if view.Truncated {
			break
		}
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return view, err
		}
	}
	sort.Slice(view.Entries, func(i, j int) bool {
		a, b := view.Entries[i], view.Entries[j]
		if a.Directory != b.Directory {
			return a.Directory
		}
		return a.Name < b.Name
	})
	return view, nil
}

func (a *AppService) PreviewTransferCopy(ctx context.Context, sourceWorkspace, sourcePath, targetWorkspace, targetPath string, selected, exclude []string) (DirectorySyncPreview, error) {
	if len(selected) > 64 {
		return DirectorySyncPreview{}, appmessage.New("backend:selectUpTo64ItemsAtATime", "每次最多选择 64 个项目")
	}
	for _, name := range selected {
		if name == "" || name == "." || name == ".." || path.Base(name) != name || strings.ContainsAny(name, "\\\x00\r\n") {
			return DirectorySyncPreview{}, appmessage.New("backend:invalidSelectedItemName", "所选项目名称无效")
		}
	}
	var preview DirectorySyncPreview
	var err error
	switch {
	case sourceWorkspace != "" && targetWorkspace != "":
		preview, err = a.PreviewRemoteDirectoryCopy(ctx, sourceWorkspace, sourcePath, targetWorkspace, targetPath, exclude)
	case sourceWorkspace == "" && targetWorkspace != "":
		preview, err = a.PreviewDirectorySyncFiltered(ctx, targetWorkspace, "upload", sourcePath, targetPath, exclude)
	case sourceWorkspace != "" && targetWorkspace == "":
		preview, err = a.PreviewDirectorySyncFiltered(ctx, sourceWorkspace, "download", targetPath, sourcePath, exclude)
	default:
		return preview, appmessage.New("backend:atLeastOneSideMustBeAConnected", "至少一侧须为已连接 SSH 工作区")
	}
	if err != nil || len(selected) == 0 {
		return preview, err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	plan := a.syncPlans[preview.ID]
	if plan == nil {
		return DirectorySyncPreview{}, appmessage.New("backend:copyPreviewExpired", "复制预览已失效")
	}
	entries := []files.SyncEntry{}
	for _, entry := range preview.Entries {
		keep := false
		for _, name := range selected {
			if entry.Path == name || strings.HasPrefix(entry.Path, name+"/") {
				keep = true
				break
			}
		}
		if keep {
			entries = append(entries, entry)
		} else {
			delete(plan.source, entry.Path)
		}
	}
	preview.Entries = entries
	plan.preview = preview
	return preview, nil
}
