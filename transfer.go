package main

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	remotefiles "github.com/Sanjeever/termquay/internal/files"
	"io"
	"os"
	"path"
	"path/filepath"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type Transfer struct {
	ID        string `json:"id"`
	Workspace string `json:"workspace"`
	Name      string `json:"name"`
	Direction string `json:"direction"`
	State     string `json:"state"`
	Total     int64  `json:"total"`
	Completed int64  `json:"completed"`
	Error     string `json:"error"`
}
type transferTask struct {
	view   Transfer
	cancel context.CancelFunc
	done   chan struct{}
}

func init() { application.RegisterEvent[Transfer]("transfer:changed") }

func (a *AppService) ListTransfers() []Transfer {
	a.mu.Lock()
	defer a.mu.Unlock()
	result := make([]Transfer, 0, len(a.transfers))
	for _, task := range a.transfers {
		result = append(result, task.view)
	}
	return result
}
func (a *AppService) CancelTransfer(id string) {
	a.mu.Lock()
	task := a.transfers[id]
	a.mu.Unlock()
	if task != nil {
		task.cancel()
	}
}
func (a *AppService) ClearTransfer(id string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if task := a.transfers[id]; task != nil && task.view.State != "running" {
		delete(a.transfers, id)
	}
}

func (a *AppService) startTransfer(workspace, name, direction string, total int64, run func(context.Context, func(int64, int64)) error) (Transfer, error) {
	a.mu.Lock()
	running := 0
	for _, task := range a.transfers {
		if task.view.State == "running" {
			running++
		}
	}
	if a.workspaces[workspace] == nil || a.closed || running >= 2 || len(a.transfers) >= 100 {
		a.mu.Unlock()
		return Transfer{}, errors.New("工作区已关闭，或传输任务达到上限（并行 2 个，历史 100 个）")
	}
	ctx, cancel := context.WithCancel(context.Background())
	id := base64.RawURLEncoding.EncodeToString(randomBytes(16))
	view := Transfer{ID: id, Workspace: workspace, Name: name, Direction: direction, State: "running", Total: total}
	task := &transferTask{view: view, cancel: cancel, done: make(chan struct{})}
	a.transfers[id] = task
	a.mu.Unlock()
	go func() {
		defer close(task.done)
		defer cancel()
		last := time.Time{}
		report := func(completed, total int64) {
			a.mu.Lock()
			task.view.Completed = completed
			task.view.Total = total
			v := task.view
			a.mu.Unlock()
			if time.Since(last) >= 150*time.Millisecond {
				last = time.Now()
				application.Get().Event.Emit("transfer:changed", v)
			}
		}
		err := run(ctx, report)
		a.mu.Lock()
		if err == nil {
			task.view.State = "done"
		} else if ctx.Err() != nil {
			task.view.State = "cancelled"
			task.view.Error = err.Error()
		} else {
			task.view.State = "failed"
			task.view.Error = err.Error()
		}
		v := task.view
		a.mu.Unlock()
		application.Get().Event.Emit("transfer:changed", v)
	}()
	return view, nil
}

type transferWriter struct {
	ctx       context.Context
	writer    io.Writer
	completed int64
	total     int64
	report    func(int64, int64)
}

func (w *transferWriter) Write(data []byte) (int, error) {
	if err := w.ctx.Err(); err != nil {
		return 0, err
	}
	n, err := w.writer.Write(data)
	w.completed += int64(n)
	w.report(w.completed, w.total)
	return n, err
}

func (a *AppService) StartUpload(id, directory string) (Transfer, error) {
	owner, err := a.terminal(id)
	if err != nil {
		return Transfer{}, err
	}
	local, err := application.Get().Dialog.OpenFile().SetTitle("选择上传文件").PromptForSingleSelection()
	if err != nil || local == "" {
		return Transfer{}, err
	}
	info, err := os.Stat(local)
	if err != nil {
		return Transfer{}, err
	}
	if !info.Mode().IsRegular() {
		return Transfer{}, errors.New("上传支持普通文件")
	}
	remote := path.Join(directory, filepath.Base(local))
	return a.startTransfer(id, filepath.Base(local), "upload", info.Size(), func(ctx context.Context, report func(int64, int64)) (result error) {
		c, close, err := a.fileClient(ctx, id)
		if err != nil {
			return err
		}
		defer close()
		source, err := os.Open(local)
		if err != nil {
			return err
		}
		defer source.Close()
		staging, err := remotefiles.CreateStaging(c, path.Dir(remote))
		if err != nil {
			return err
		}
		temporary := path.Join(staging, "data")
		target, err := c.OpenFile(temporary, os.O_CREATE|os.O_EXCL|os.O_WRONLY)
		if err != nil {
			return errors.Join(err, remotefiles.RemoveStaging(c, staging))
		}
		defer func() {
			target.Close()
			if ctx.Err() == nil {
				cleanupErr := remotefiles.RemoveStaging(c, staging)
				if result == nil && cleanupErr != nil {
					result = fmt.Errorf("文件已上传，但临时目录清理失败: %w", cleanupErr)
				} else {
					result = errors.Join(result, cleanupErr)
				}
				return
			}
			cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			cleanup, err := owner.FileClient(cleanupCtx)
			if err != nil {
				result = errors.Join(result, errors.New("远端临时目录可能残留: "+staging))
				return
			}
			defer cleanup.Close()
			if err = remotefiles.RemoveStaging(cleanup, staging); err != nil {
				result = errors.Join(result, err)
			}
		}()
		writer := &transferWriter{ctx: ctx, writer: target, report: report, total: info.Size()}
		if _, err = io.CopyBuffer(writer, source, make([]byte, 64<<10)); err != nil {
			return err
		}
		if err = target.Chmod(info.Mode().Perm()); err != nil {
			return err
		}
		if err = target.Close(); err != nil {
			return err
		}
		if err = ctx.Err(); err != nil {
			return err
		}
		if err = c.Rename(temporary, remote); err != nil {
			return errors.New("上传发布失败，同名目标不会被覆盖: " + err.Error())
		}
		return nil
	})
}

func (a *AppService) StartDownload(id, remote string) (Transfer, error) {
	local, err := application.Get().Dialog.SaveFile().SetMessage("保存下载文件").SetFilename(path.Base(remote)).PromptForSingleSelection()
	if err != nil || local == "" {
		return Transfer{}, err
	}
	return a.startTransfer(id, path.Base(remote), "download", 0, func(ctx context.Context, report func(int64, int64)) (result error) {
		c, close, err := a.fileClient(ctx, id)
		if err != nil {
			return err
		}
		defer close()
		info, err := c.Lstat(remote)
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return errors.New("下载支持普通文件")
		}
		source, err := c.Open(remote)
		if err != nil {
			return err
		}
		defer source.Close()
		target, err := os.CreateTemp(filepath.Dir(local), ".termquay-download-*")
		if err != nil {
			return err
		}
		published := false
		defer func() {
			target.Close()
			if !published {
				result = errors.Join(result, os.Remove(target.Name()))
			}
		}()
		writer := &transferWriter{ctx: ctx, writer: target, report: report, total: info.Size()}
		if _, err = io.CopyBuffer(writer, source, make([]byte, 64<<10)); err != nil {
			return err
		}
		if err = target.Sync(); err != nil {
			return err
		}
		if err = target.Close(); err != nil {
			return err
		}
		if err = ctx.Err(); err != nil {
			return err
		}
		if err = os.Rename(target.Name(), local); err != nil {
			return err
		}
		published = true
		return nil
	})
}
