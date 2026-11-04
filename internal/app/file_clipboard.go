package app

import (
	"context"
	"encoding/base64"
	"errors"
	"os"
	"path"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type remoteFileClipboard struct {
	workspace string
	paths     []string
	token     string
}

func (a *AppService) CopyRemoteFiles(id string, paths []string) error {
	if err := validateRemotePaths(paths); err != nil {
		return err
	}
	clipboard := &remoteFileClipboard{workspace: id, paths: append([]string(nil), paths...), token: "termquay://files/" + base64.RawURLEncoding.EncodeToString(randomBytes(24))}
	a.fileClipboardMu.Lock()
	defer a.fileClipboardMu.Unlock()
	a.mu.Lock()
	if a.closed || a.workspaces[id] == nil {
		a.mu.Unlock()
		return errors.New("SSH 工作区已关闭")
	}
	a.mu.Unlock()
	if !application.Get().Clipboard.SetText(clipboard.token) {
		return errors.New("无法写入文件剪贴板")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closed || a.workspaces[id] == nil {
		return errors.New("SSH 工作区已关闭")
	}
	a.fileClipboard = clipboard
	return nil
}

func (a *AppService) PasteClipboardFiles(ctx context.Context, id, directory string) error {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	a.fileClipboardMu.Lock()
	text, _ := application.Get().Clipboard.Text()
	a.mu.Lock()
	clipboard := a.fileClipboard
	a.mu.Unlock()
	a.fileClipboardMu.Unlock()
	var preview UploadPreview
	var err error
	if clipboard != nil && text == clipboard.token {
		preview, err = a.prepareRemotePaste(ctx, clipboard, id, directory)
	} else if strings.HasPrefix(text, "termquay://files/") {
		return errors.New("文件剪贴板已失效，请在来源工作区重新复制")
	} else {
		var paths []string
		paths, err = localClipboardFiles()
		if err == nil {
			preview, err = a.prepareUploads(id, directory, paths)
			if err == nil {
				preview.Source = "本机剪贴板"
				a.mu.Lock()
				if a.uploadPreview != nil && a.uploadPreview.view.ID == preview.ID {
					a.uploadPreview.view.Source = preview.Source
				}
				a.mu.Unlock()
			}
		}
	}
	if err != nil {
		return err
	}
	application.Get().Event.Emit("files:upload-prepared", UploadPreparation{Preview: preview})
	return nil
}

func (a *AppService) prepareRemotePaste(ctx context.Context, clipboard *remoteFileClipboard, id, directory string) (UploadPreview, error) {
	if !path.IsAbs(directory) || len(directory) > 4096 || strings.ContainsRune(directory, 0) {
		return UploadPreview{}, errors.New("请输入有效的远端绝对目录")
	}
	sourceOwner, err := a.terminal(clipboard.workspace)
	if err != nil {
		return UploadPreview{}, err
	}
	client, release, err := a.fileClient(ctx, clipboard.workspace)
	if err != nil {
		return UploadPreview{}, err
	}
	defer release()
	view := UploadPreview{ID: base64.RawURLEncoding.EncodeToString(randomBytes(16)), Workspace: id, Directory: path.Clean(directory), Files: []UploadFile{}}
	infos := make([]os.FileInfo, 0, len(clipboard.paths))
	names := map[string]bool{}
	for _, source := range clipboard.paths {
		if err := ctx.Err(); err != nil {
			return UploadPreview{}, err
		}
		file := UploadFile{Name: path.Base(source), Path: source}
		info, err := client.Lstat(source)
		switch {
		case err != nil:
			file.Error = err.Error()
		case !info.Mode().IsRegular() || info.Mode()&(os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != 0:
			file.Error = "粘贴支持无特殊权限位的普通文件；文件夹请使用目录复制"
		case names[file.Name]:
			file.Error = "来源包含同名文件，请分批复制"
		default:
			file.Size, file.Supported = info.Size(), true
			names[file.Name] = true
		}
		infos = append(infos, info)
		view.Files = append(view.Files, file)
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	source, target := a.workspaces[clipboard.workspace], a.workspaces[id]
	if a.closed || source == nil || target == nil {
		return UploadPreview{}, errors.New("来源或目标 SSH 工作区已关闭")
	}
	if a.uploadPreview != nil {
		return UploadPreview{}, errors.New("请先确认或取消当前文件上传或粘贴")
	}
	view.Source, view.Target = source.target, target.target
	a.uploadPreview = &pendingUpload{view: view, paths: append([]string(nil), clipboard.paths...), sourceWorkspace: clipboard.workspace, sourceOwner: sourceOwner, sourceFiles: infos}
	return view, nil
}
