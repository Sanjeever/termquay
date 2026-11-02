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
	"sort"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type Transfer struct {
	ID              string `json:"id"`
	Workspace       string `json:"workspace"`
	Name            string `json:"name"`
	Direction       string `json:"direction"`
	State           string `json:"state"`
	Total           int64  `json:"total"`
	Completed       int64  `json:"completed"`
	Error           string `json:"error"`
	Sequence        uint64 `json:"sequence"`
	Retryable       bool   `json:"retryable"`
	Target          string `json:"target"`
	SourcePath      string `json:"source_path"`
	DestinationPath string `json:"destination_path"`
}
type transferTask struct {
	view   Transfer
	cancel context.CancelFunc
	done   chan struct{}
	ctx    context.Context
	run    func(context.Context, func(int64, int64)) error
	spec   *transferSpec
}
type transferSpec struct {
	workspace, local, remote, direction string
	overwrite                           bool
	syncPlanID                          string
}

var errTransferSkipped = errors.New("同名目标已跳过")

type transferExpectation struct {
	source, target remotefiles.SyncNode
	targetExists   bool
}

func checkTransferExpectation(source, target os.FileInfo, expected []transferExpectation) error {
	if len(expected) == 0 {
		return nil
	}
	value := expected[0]
	if !remotefiles.SameSyncNode(remotefiles.SyncInfo(source), value.source) {
		return errors.New("源文件自预览后已变化")
	}
	if value.targetExists {
		if target == nil || !remotefiles.SameSyncNode(remotefiles.SyncInfo(target), value.target) {
			return errors.New("目标自预览后已变化")
		}
	} else if target != nil {
		return errors.New("目标自预览后已出现")
	}
	return nil
}

type TransferBatch struct {
	Items  []Transfer `json:"items"`
	Errors []string   `json:"errors"`
}
type UploadDropResult struct {
	Workspace string        `json:"workspace"`
	Result    TransferBatch `json:"result"`
	Error     string        `json:"error"`
}

func init() {
	application.RegisterEvent[Transfer]("transfer:changed")
	application.RegisterEvent[UploadDropResult]("files:upload-result")
}

func (a *AppService) ListTransfers() []Transfer {
	a.mu.Lock()
	defer a.mu.Unlock()
	result := make([]Transfer, 0, len(a.transfers))
	for _, task := range a.transfers {
		result = append(result, task.view)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Sequence < result[j].Sequence })
	return result
}
func (a *AppService) CancelTransfer(id string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	task := a.transfers[id]
	if task != nil {
		a.cancelTransferLocked(task)
	}
}
func (a *AppService) cancelTransferLocked(task *transferTask) {
	task.cancel()
	if task.view.State != "queued" {
		return
	}
	task.view.State = "cancelled"
	if task.spec != nil && task.spec.syncPlanID != "" {
		delete(a.syncPlans, task.spec.syncPlanID)
	}
	task.run = nil
	for i, id := range a.transferQueue {
		if id == task.view.ID {
			a.transferQueue = append(a.transferQueue[:i], a.transferQueue[i+1:]...)
			break
		}
	}
	close(task.done)
	a.transferEvent(task.view)
}
func (a *AppService) ClearTransfer(id string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if task := a.transfers[id]; task != nil && task.view.State != "running" && task.view.State != "queued" {
		delete(a.transfers, id)
	}
}

func (a *AppService) ClearFinishedTransfers() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	removed := []string{}
	for id, task := range a.transfers {
		switch task.view.State {
		case "done", "cancelled", "failed", "skipped":
			delete(a.transfers, id)
			removed = append(removed, id)
		}
	}
	return removed
}

func (a *AppService) startTransfer(workspace, name, direction string, total int64, run func(context.Context, func(int64, int64)) error, specification ...transferSpec) (Transfer, error) {
	a.mu.Lock()
	if a.workspaces[workspace] == nil || a.closed || len(a.transferQueue) >= 32 || len(a.transfers) >= 100 {
		a.mu.Unlock()
		return Transfer{}, errors.New("工作区已关闭，或传输任务达到上限（并行 2 个，等待 32 个，历史 100 个）")
	}
	ctx, cancel := context.WithCancel(context.Background())
	id := base64.RawURLEncoding.EncodeToString(randomBytes(16))
	a.transferSequence++
	view := Transfer{ID: id, Workspace: workspace, Name: name, Direction: direction, State: "queued", Total: total, Sequence: a.transferSequence, Target: a.workspaces[workspace].target}
	task := &transferTask{view: view, cancel: cancel, done: make(chan struct{}), ctx: ctx, run: run}
	if len(specification) > 0 {
		spec := specification[0]
		task.spec = &spec
		task.view.Retryable = spec.direction == "upload" || spec.direction == "download"
		if spec.direction == "upload" {
			task.view.SourcePath = spec.local
			task.view.DestinationPath = spec.remote
		} else {
			task.view.SourcePath = spec.remote
			task.view.DestinationPath = spec.local
		}
	}
	a.transfers[id] = task
	a.transferQueue = append(a.transferQueue, id)
	a.transferEvent(task.view)
	a.dispatchTransfersLocked()
	view = task.view
	a.mu.Unlock()
	return view, nil
}

func (a *AppService) dispatchTransfersLocked() {
	running := 0
	for _, task := range a.transfers {
		if task.view.State == "running" {
			running++
		}
	}
	for !a.closed && running < 2 && len(a.transferQueue) > 0 {
		id := a.transferQueue[0]
		a.transferQueue = a.transferQueue[1:]
		task := a.transfers[id]
		task.view.State = "running"
		a.transferEvent(task.view)
		running++
		go a.runTransfer(task)
	}
}
func (a *AppService) runTransfer(task *transferTask) {
	defer task.cancel()
	last := time.Time{}
	report := func(completed, total int64) {
		a.mu.Lock()
		task.view.Completed = completed
		task.view.Total = total
		if time.Since(last) >= 150*time.Millisecond {
			last = time.Now()
			a.transferEvent(task.view)
		}
		a.mu.Unlock()
	}
	err := task.run(task.ctx, report)
	a.mu.Lock()
	if errors.Is(err, errTransferSkipped) {
		task.view.State = "skipped"
	} else if err == nil {
		task.view.State = "done"
	} else if task.ctx.Err() != nil {
		task.view.State = "cancelled"
		task.view.Error = err.Error()
	} else {
		task.view.State = "failed"
		task.view.Error = err.Error()
	}
	task.run = nil
	if task.spec != nil && task.spec.syncPlanID != "" {
		delete(a.syncPlans, task.spec.syncPlanID)
	}
	close(task.done)
	a.transferEvent(task.view)
	a.dispatchTransfersLocked()
	a.mu.Unlock()
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
	local, err := application.Get().Dialog.OpenFile().SetTitle("选择上传文件").PromptForSingleSelection()
	if err != nil || local == "" {
		return Transfer{}, err
	}
	return a.uploadPath(id, local, path.Join(directory, filepath.Base(local)), false)
}
func (a *AppService) StartUploads(id, directory string, overwrite bool) (TransferBatch, error) {
	paths, err := application.Get().Dialog.OpenFile().SetTitle("选择上传文件").PromptForMultipleSelection()
	if err != nil {
		return TransferBatch{}, err
	}
	return a.uploadFiles(id, directory, paths, overwrite)
}
func (a *AppService) uploadFiles(id, directory string, locals []string, overwrite bool) (TransferBatch, error) {
	if len(locals) > 64 || !path.IsAbs(directory) {
		return TransferBatch{}, errors.New("上传目录无效或文件超过 64 个")
	}
	if _, err := a.terminal(id); err != nil {
		return TransferBatch{}, err
	}
	result := TransferBatch{Items: []Transfer{}, Errors: []string{}}
	for _, local := range locals {
		view, err := a.uploadPath(id, local, path.Join(directory, filepath.Base(local)), overwrite)
		if err != nil {
			result.Errors = append(result.Errors, filepath.Base(local)+": "+err.Error())
		} else {
			result.Items = append(result.Items, view)
		}
	}
	return result, nil
}
func (a *AppService) uploadPath(id, local, remote string, overwrite bool) (Transfer, error) {
	size, run, err := a.uploadOperation(id, local, remote, overwrite)
	if err != nil {
		return Transfer{}, err
	}
	return a.startTransfer(id, path.Base(remote), "upload", size, run, transferSpec{workspace: id, local: local, remote: remote, direction: "upload", overwrite: overwrite})
}
func (a *AppService) uploadOperation(id, local, remote string, overwrite bool, expected ...transferExpectation) (int64, func(context.Context, func(int64, int64)) error, error) {
	if !filepath.IsAbs(local) || !path.IsAbs(remote) || len(local) > 4096 || len(remote) > 4096 {
		return 0, nil, errors.New("传输路径无效")
	}
	owner, err := a.terminal(id)
	if err != nil {
		return 0, nil, err
	}
	info, err := os.Lstat(local)
	if err != nil {
		return 0, nil, err
	}
	if !info.Mode().IsRegular() {
		return 0, nil, errors.New("上传支持普通文件")
	}
	return info.Size(), func(ctx context.Context, report func(int64, int64)) (result error) {
		c, close, err := a.fileClient(ctx, id)
		if err != nil {
			return err
		}
		defer close()
		before, err := c.Lstat(remote)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		if before != nil {
			if !overwrite {
				return errTransferSkipped
			}
			if !before.Mode().IsRegular() {
				return errors.New("覆盖目标必须是普通文件")
			}
		}
		if err = checkTransferExpectation(info, before, expected); err != nil {
			return err
		}
		source, err := os.Open(local)
		if err != nil {
			return err
		}
		defer source.Close()
		current, err := source.Stat()
		if err != nil {
			return err
		}
		if !os.SameFile(info, current) || info.Size() != current.Size() || !info.ModTime().Equal(current.ModTime()) {
			return errors.New("本地源文件已变化，请显式重试")
		}
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
		if err = c.Chtimes(temporary, info.ModTime(), info.ModTime()); err != nil {
			return err
		}
		if err = ctx.Err(); err != nil {
			return err
		}
		current, err = source.Stat()
		if err != nil {
			return err
		}
		if info.Size() != current.Size() || !info.ModTime().Equal(current.ModTime()) {
			return errors.New("上传期间本地源文件已变化")
		}
		latest, err := c.Lstat(remote)
		if before == nil {
			if err == nil {
				return errors.New("目标在上传期间出现，发布已阻止")
			}
			if !os.IsNotExist(err) {
				return err
			}
		} else {
			if err != nil {
				return err
			}
			if before.Size() != latest.Size() || !before.ModTime().Equal(latest.ModTime()) || before.Mode() != latest.Mode() {
				return errors.New("目标在上传期间已变化，覆盖已阻止")
			}
		}
		if before != nil {
			err = c.PosixRename(temporary, remote)
		} else {
			err = c.Rename(temporary, remote)
		}
		if err != nil {
			return fmt.Errorf("上传发布失败: %w", err)
		}
		return nil
	}, nil
}

func (a *AppService) StartDownload(id, remote string) (Transfer, error) {
	local, err := application.Get().Dialog.SaveFile().SetMessage("保存下载文件").SetFilename(path.Base(remote)).PromptForSingleSelection()
	if err != nil || local == "" {
		return Transfer{}, err
	}
	return a.downloadPath(id, remote, local, true)
}

func (a *AppService) StartDownloads(id string, remotes []string, overwrite bool) (TransferBatch, error) {
	if err := validateRemotePaths(remotes); err != nil {
		return TransferBatch{}, err
	}
	if _, err := a.terminal(id); err != nil {
		return TransferBatch{}, err
	}
	directory, err := application.Get().Dialog.OpenFile().SetTitle("选择下载目录").CanChooseFiles(false).CanChooseDirectories(true).PromptForSingleSelection()
	if err != nil || directory == "" {
		return TransferBatch{}, err
	}
	return a.downloadFiles(id, directory, remotes, overwrite)
}

func (a *AppService) downloadFiles(id, directory string, remotes []string, overwrite bool) (TransferBatch, error) {
	if err := validateRemotePaths(remotes); err != nil {
		return TransferBatch{}, err
	}
	if !filepath.IsAbs(directory) {
		return TransferBatch{}, errors.New("下载目录必须是本机绝对路径")
	}
	info, err := os.Stat(directory)
	if err != nil {
		return TransferBatch{}, err
	}
	if !info.IsDir() {
		return TransferBatch{}, errors.New("下载目标不是目录")
	}
	if _, err := a.terminal(id); err != nil {
		return TransferBatch{}, err
	}
	result := TransferBatch{Items: []Transfer{}, Errors: []string{}}
	for _, remote := range remotes {
		name := path.Base(remote)
		if filepath.Base(name) != name || name == "." || name == ".." {
			result.Errors = append(result.Errors, remote+": 本机文件名无效，未入队")
			continue
		}
		view, err := a.downloadPath(id, remote, filepath.Join(directory, name), overwrite)
		if err != nil {
			result.Errors = append(result.Errors, remote+": 未入队："+err.Error())
		} else {
			result.Items = append(result.Items, view)
		}
	}
	return result, nil
}
func (a *AppService) downloadPath(id, remote, local string, overwrite bool) (Transfer, error) {
	run, err := a.downloadOperation(id, remote, local, overwrite)
	if err != nil {
		return Transfer{}, err
	}
	return a.startTransfer(id, path.Base(remote), "download", 0, run, transferSpec{workspace: id, local: local, remote: remote, direction: "download", overwrite: overwrite})
}
func (a *AppService) downloadOperation(id, remote, local string, overwrite bool, expected ...transferExpectation) (func(context.Context, func(int64, int64)) error, error) {
	if !filepath.IsAbs(local) || !path.IsAbs(remote) {
		return nil, errors.New("传输路径无效")
	}
	return func(ctx context.Context, report func(int64, int64)) (result error) {
		before, err := os.Lstat(local)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		if before != nil {
			if !overwrite {
				return errTransferSkipped
			}
			if !before.Mode().IsRegular() {
				return errors.New("覆盖目标必须是普通文件")
			}
		}
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
		if err = checkTransferExpectation(info, before, expected); err != nil {
			return err
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
		if err = os.Chtimes(target.Name(), info.ModTime(), info.ModTime()); err != nil {
			return err
		}
		if err = target.Close(); err != nil {
			return err
		}
		if err = ctx.Err(); err != nil {
			return err
		}
		remoteLatest, err := c.Lstat(remote)
		if err != nil {
			return err
		}
		if info.Size() != remoteLatest.Size() || !info.ModTime().Equal(remoteLatest.ModTime()) || info.Mode() != remoteLatest.Mode() {
			return errors.New("下载期间远端源文件已变化")
		}
		latest, err := os.Lstat(local)
		if before == nil {
			if err == nil {
				return errors.New("本地目标在下载期间出现")
			}
			if !os.IsNotExist(err) {
				return err
			}
		} else {
			if err != nil {
				return err
			}
			if !os.SameFile(before, latest) || before.Size() != latest.Size() || !before.ModTime().Equal(latest.ModTime()) {
				return errors.New("本地目标在下载期间已变化")
			}
		}
		if before == nil {
			if err = os.Link(target.Name(), local); err != nil {
				return err
			}
			if err = os.Remove(target.Name()); err != nil {
				published = true
				return fmt.Errorf("文件已下载，暂存清理失败: %w", err)
			}
			published = true
			return nil
		}
		if err = os.Rename(target.Name(), local); err != nil {
			return err
		}
		published = true
		return nil
	}, nil
}

func (a *AppService) RetryTransfer(id, newName string, overwrite bool) (Transfer, error) {
	a.mu.Lock()
	task := a.transfers[id]
	if task == nil || task.spec == nil || !task.view.Retryable || (task.view.State != "failed" && task.view.State != "cancelled" && task.view.State != "skipped") {
		a.mu.Unlock()
		return Transfer{}, errors.New("此任务不能重试")
	}
	spec := *task.spec
	a.mu.Unlock()
	if newName != "" {
		if newName == "." || newName == ".." || strings.ContainsAny(newName, "/\\\x00\r\n:") {
			return Transfer{}, errors.New("新文件名无效")
		}
		if spec.direction == "upload" {
			spec.remote = path.Join(path.Dir(spec.remote), newName)
		} else {
			spec.local = filepath.Join(filepath.Dir(spec.local), newName)
		}
	}
	if spec.direction == "upload" {
		return a.uploadPath(spec.workspace, spec.local, spec.remote, overwrite)
	}
	return a.downloadPath(spec.workspace, spec.remote, spec.local, overwrite)
}
