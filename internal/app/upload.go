package app

import (
	"context"
	"encoding/base64"
	"errors"
	"os"
	"path"
	"path/filepath"

	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type UploadFile struct {
	Name      string `json:"name"`
	Path      string `json:"path,omitempty"`
	Size      int64  `json:"size"`
	Supported bool   `json:"supported"`
	Error     string `json:"error"`
}

type UploadPreview struct {
	ID        string       `json:"id"`
	Workspace string       `json:"workspace"`
	Target    string       `json:"target"`
	Source    string       `json:"source,omitempty"`
	Directory string       `json:"directory"`
	Files     []UploadFile `json:"files"`
}

type UploadPreparation struct {
	Preview UploadPreview `json:"preview"`
	Error   string        `json:"error"`
}

type UploadSubmission struct {
	Batch   TransferBatch `json:"batch"`
	Pending UploadPreview `json:"pending"`
}

type pendingUpload struct {
	view            UploadPreview
	paths           []string
	sourceWorkspace string
	sourceOwner     *terminal.Terminal
	sourceFiles     []os.FileInfo
	submitting      bool
}

func (a *AppService) ChooseUploadFiles(id, directory string) (UploadPreview, error) {
	paths, err := application.Get().Dialog.OpenFile().SetTitle("选择上传文件").PromptForMultipleSelection()
	if err != nil || len(paths) == 0 {
		return UploadPreview{}, err
	}
	return a.prepareUploads(id, directory, paths)
}

func (a *AppService) prepareUploads(id, directory string, paths []string) (UploadPreview, error) {
	if len(paths) == 0 || len(paths) > 64 || !path.IsAbs(directory) || len(directory) > 4096 {
		return UploadPreview{}, errors.New("请选择 1 至 64 个文件和有效的远端绝对目录")
	}
	view := UploadPreview{ID: base64.RawURLEncoding.EncodeToString(randomBytes(16)), Workspace: id, Directory: path.Clean(directory), Files: []UploadFile{}}
	names := make(map[string]bool, len(paths))
	for _, local := range paths {
		file := UploadFile{Name: filepath.Base(local), Path: local}
		if !filepath.IsAbs(local) || len(local) > 4096 {
			file.Error = "本地路径无效"
		} else if info, err := os.Lstat(local); err != nil {
			file.Error = err.Error()
		} else if info.IsDir() {
			file.Error = "文件夹请使用目录同步"
		} else if !info.Mode().IsRegular() {
			file.Error = "上传支持普通文件，不支持符号链接或特殊文件"
		} else if names[file.Name] {
			file.Error = "本批次包含同名文件，请分批上传或先修改本地文件名"
		} else {
			file.Size, file.Supported = info.Size(), true
			names[file.Name] = true
		}
		view.Files = append(view.Files, file)
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	owner := a.workspaces[id]
	if owner == nil || a.closed {
		return UploadPreview{}, errors.New("SSH 工作区已关闭")
	}
	if a.uploadPreview != nil {
		return UploadPreview{}, errors.New("请先确认或取消当前上传")
	}
	view.Target = owner.target
	a.uploadPreview = &pendingUpload{view: view, paths: append([]string(nil), paths...)}
	return view, nil
}

func (a *AppService) DiscardUpload(id string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if pending := a.uploadPreview; pending != nil && pending.view.ID == id {
		if pending.submitting {
			return errors.New("正在加入传输队列，请稍候")
		}
		a.uploadPreview = nil
	}
	return nil
}

func (a *AppService) ConfirmUpload(ctx context.Context, id, directory string, overwrite bool) (UploadSubmission, error) {
	a.mu.Lock()
	pending := a.uploadPreview
	if pending == nil || pending.view.ID != id || pending.submitting {
		a.mu.Unlock()
		return UploadSubmission{}, errors.New("上传确认已失效或正在提交")
	}
	if !path.IsAbs(directory) || len(directory) > 4096 {
		a.mu.Unlock()
		return UploadSubmission{}, errors.New("请输入有效的远端绝对目录")
	}
	pending.submitting = true
	a.mu.Unlock()
	defer func() { a.mu.Lock(); pending.submitting = false; a.mu.Unlock() }()
	c, close, err := a.fileClient(ctx, pending.view.Workspace)
	if err != nil {
		return UploadSubmission{}, err
	}
	info, err := c.Stat(directory)
	close()
	if err != nil {
		return UploadSubmission{}, err
	}
	if !info.IsDir() {
		return UploadSubmission{}, errors.New("上传目标必须是目录")
	}
	directory = path.Clean(directory)
	result := UploadSubmission{Batch: TransferBatch{Items: []Transfer{}, Errors: []string{}}}
	remaining := UploadPreview{ID: id, Workspace: pending.view.Workspace, Target: pending.view.Target, Source: pending.view.Source, Directory: directory, Files: []UploadFile{}}
	paths := []string{}
	sourceFiles := []os.FileInfo{}
	for i, file := range pending.view.Files {
		if file.Supported {
			var view Transfer
			var run func(context.Context, func(int64, int64)) error
			var size int64
			remote := path.Join(directory, file.Name)
			err = ctx.Err()
			if err == nil && pending.sourceWorkspace != "" {
				var targetOwner *terminal.Terminal
				targetOwner, err = a.terminal(pending.view.Workspace)
				if err == nil {
					size = pending.sourceFiles[i].Size()
					run = a.remoteCopyOperation(pending.sourceWorkspace, pending.paths[i], pending.view.Workspace, remote, overwrite, true, pending.sourceOwner, targetOwner, pending.sourceFiles[i], nil)
				}
			} else if err == nil {
				size, run, err = a.uploadOperation(pending.view.Workspace, pending.paths[i], remote, overwrite)
			}
			if err == nil {
				if pending.sourceWorkspace != "" {
					view, err = a.startTransfer(pending.view.Workspace, file.Name, "copy", size, run, transferSpec{workspace: pending.view.Workspace, remote: pending.paths[i], local: remote, direction: "copy", batchID: id})
				} else {
					view, err = a.startTransfer(pending.view.Workspace, file.Name, "upload", size, run, transferSpec{workspace: pending.view.Workspace, local: pending.paths[i], remote: remote, direction: "upload", overwrite: overwrite, batchID: id})
				}
			}
			if err == nil {
				result.Batch.Items = append(result.Batch.Items, view)
				continue
			}
			file.Error = err.Error()
		}
		result.Batch.Errors = append(result.Batch.Errors, file.Name+": "+file.Error)
		remaining.Files = append(remaining.Files, file)
		paths = append(paths, pending.paths[i])
		if pending.sourceWorkspace != "" {
			sourceFiles = append(sourceFiles, pending.sourceFiles[i])
		}
	}
	a.mu.Lock()
	if a.uploadPreview == pending {
		if len(paths) == 0 {
			a.uploadPreview = nil
		} else {
			pending.view, pending.paths = remaining, paths
			pending.sourceFiles = sourceFiles
			result.Pending = remaining
		}
	}
	a.mu.Unlock()
	return result, nil
}
