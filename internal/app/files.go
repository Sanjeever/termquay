package app

import (
	"context"
	"errors"
	"os"
	"path"

	"github.com/Sanjeever/termquay/internal/files"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"github.com/pkg/sftp"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func (a *AppService) terminal(id string) (*terminal.Terminal, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	p := a.workspaces[id]
	if p == nil {
		return nil, errors.New("SSH 工作区已关闭")
	}
	return p.terminal, nil
}

func (a *AppService) fileClient(ctx context.Context, id string) (*sftp.Client, func(), error) {
	select {
	case a.fileSlots <- struct{}{}:
	case <-ctx.Done():
		return nil, nil, ctx.Err()
	}
	t, err := a.terminal(id)
	if err != nil {
		<-a.fileSlots
		return nil, nil, err
	}
	c, err := t.FileClient(ctx)
	if err != nil {
		<-a.fileSlots
		return nil, nil, err
	}
	stop := context.AfterFunc(ctx, func() { c.Close() })
	return c, func() { stop(); c.Close(); <-a.fileSlots }, nil
}

func (a *AppService) ReadDirectory(ctx context.Context, id, remote string) (files.Directory, error) {
	c, close, err := a.fileClient(ctx, id)
	if err != nil {
		return files.Directory{}, err
	}
	defer close()
	return files.List(ctx, c, remote)
}
func (a *AppService) ReadRemoteFile(ctx context.Context, id, remote string) (files.Document, error) {
	return a.ReadRemoteFileEncoded(ctx, id, remote, "UTF-8")
}

func (a *AppService) ReadRemoteFileEncoded(ctx context.Context, id, remote, charset string) (files.Document, error) {
	c, close, err := a.fileClient(ctx, id)
	if err != nil {
		return files.Document{}, err
	}
	defer close()
	return files.ReadEncoded(c, remote, charset)
}

func (a *AppService) DownloadFileDraft(document files.Document) error {
	data, err := files.EncodeDocument(document)
	if err != nil {
		return err
	}
	filename, err := application.Get().Dialog.SaveFile().SetMessage("下载当前文件草稿").SetFilename(path.Base(document.Path)).PromptForSingleSelection()
	if err != nil || filename == "" {
		return err
	}
	return os.WriteFile(filename, data, 0600)
}
func (a *AppService) SaveRemoteFile(ctx context.Context, id string, document files.Document) (files.Document, error) {
	c, close, err := a.fileClient(ctx, id)
	if err != nil {
		return files.Document{}, err
	}
	defer close()
	history, err := a.GetFileHistory(id, document.Path)
	if err != nil {
		return files.Document{}, err
	}
	if history.Enabled {
		charset := document.OriginalEncoding
		if charset == "" {
			charset = document.Encoding
		}
		previous, err := files.ReadEncoded(c, document.Path, charset)
		if err != nil {
			return files.Document{}, err
		}
		if previous.Revision != document.Revision {
			return files.Document{}, errors.New("远端文件已变化，请先对比与合并")
		}
		if err := a.recordFileVersion(id, previous); err != nil {
			return files.Document{}, err
		}
	}
	return files.Save(c, document)
}

func (a *AppService) CreateRemoteDirectory(ctx context.Context, id, remote string) error {
	c, close, err := a.fileClient(ctx, id)
	if err != nil {
		return err
	}
	defer close()
	return c.Mkdir(remote)
}
func (a *AppService) RenameRemotePath(ctx context.Context, id, oldPath, newPath string) error {
	c, close, err := a.fileClient(ctx, id)
	if err != nil {
		return err
	}
	defer close()
	return c.Rename(oldPath, newPath)
}
func (a *AppService) DeleteRemotePath(ctx context.Context, id, remote string) error {
	if remote == "" || path.Clean(remote) == "/" || path.Clean(remote) == "." {
		return errors.New("不能删除远端根目录或当前目录")
	}
	c, close, err := a.fileClient(ctx, id)
	if err != nil {
		return err
	}
	defer close()
	return deleteRemotePath(c, remote)
}

func deleteRemotePath(c *sftp.Client, remote string) error {
	info, err := c.Lstat(remote)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return c.RemoveDirectory(remote)
	}
	return c.Remove(remote)
}

type RemotePathResult struct {
	Path   string `json:"path"`
	Target string `json:"target"`
	State  string `json:"state"`
	Error  string `json:"error"`
}

func validateRemotePaths(paths []string) error {
	if len(paths) == 0 || len(paths) > 64 {
		return errors.New("每批需选择 1 至 64 个路径")
	}
	seen := map[string]bool{}
	for _, remote := range paths {
		if len(remote) > 4096 || !path.IsAbs(remote) || path.Clean(remote) != remote || remote == "/" || seen[remote] {
			return errors.New("远端路径无效、重复或指向根目录")
		}
		seen[remote] = true
	}
	return nil
}

func (a *AppService) MoveRemotePaths(ctx context.Context, id string, paths []string, directory string) ([]RemotePathResult, error) {
	if err := validateRemotePaths(paths); err != nil {
		return nil, err
	}
	if !path.IsAbs(directory) || path.Clean(directory) != directory || len(directory) > 4096 {
		return nil, errors.New("目标目录必须是远端绝对路径")
	}
	c, close, err := a.fileClient(ctx, id)
	if err != nil {
		return nil, err
	}
	defer close()
	info, err := c.Lstat(directory)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, errors.New("目标必须是目录")
	}
	results := make([]RemotePathResult, 0, len(paths))
	for _, remote := range paths {
		result := RemotePathResult{Path: remote, Target: path.Join(directory, path.Base(remote)), State: "done"}
		if ctx.Err() != nil {
			result.State = "not_run"
			result.Error = ctx.Err().Error()
		} else if result.Path == result.Target {
			result.State = "skipped"
			result.Error = "源路径与目标相同"
		} else {
			info, err := c.Lstat(remote)
			if err == nil && !(info.Mode().IsRegular() || info.IsDir() || info.Mode()&os.ModeSymlink != 0) {
				err = errors.New("不支持移动特殊文件")
			}
			if err == nil {
				_, targetErr := c.Lstat(result.Target)
				if targetErr == nil {
					err = errors.New("同名目标已存在，未覆盖")
				} else if !os.IsNotExist(targetErr) {
					err = targetErr
				}
			}
			if err == nil {
				err = c.Rename(remote, result.Target)
			}
			if err != nil {
				result.State = "failed"
				result.Error = err.Error()
			}
		}
		results = append(results, result)
	}
	return results, nil
}

func (a *AppService) DeleteRemotePaths(ctx context.Context, id string, paths []string) ([]RemotePathResult, error) {
	if err := validateRemotePaths(paths); err != nil {
		return nil, err
	}
	c, close, err := a.fileClient(ctx, id)
	if err != nil {
		return nil, err
	}
	defer close()
	results := make([]RemotePathResult, 0, len(paths))
	for _, remote := range paths {
		result := RemotePathResult{Path: remote, State: "done"}
		if ctx.Err() != nil {
			result.State = "not_run"
			result.Error = ctx.Err().Error()
		} else if err := deleteRemotePath(c, remote); err != nil {
			result.State = "failed"
			result.Error = err.Error()
		}
		results = append(results, result)
	}
	return results, nil
}
