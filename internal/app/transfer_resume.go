package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"time"

	"github.com/Sanjeever/termquay/internal/files"
	"github.com/pkg/sftp"
)

type transferContextKey struct{}
type transferResume struct {
	source, before     os.FileInfo
	offset             int64
	temporary, staging string
	partial            *savedTransferFile
}

func (a *AppService) retainTransferCleanup(ctx context.Context, staging string) {
	if task, ok := ctx.Value(transferContextKey{}).(*transferTask); ok {
		a.mu.Lock()
		task.cleanupStaging = staging
		task.view.CleanupRequired = true
		task.view.TemporaryPath = staging
		a.mu.Unlock()
	}
}

func (a *AppService) retainTransfer(ctx context.Context, state *transferResume) bool {
	task, _ := ctx.Value(transferContextKey{}).(*transferTask)
	if task == nil || task.spec == nil || task.spec.direction == "sync" || state.offset <= 0 {
		return false
	}
	a.mu.Lock()
	task.resume = state
	a.mu.Unlock()
	return true
}

func sameTransferVersion(before, after os.FileInfo, local bool) bool {
	if before == nil || after == nil {
		return before == nil && after == nil
	}
	return before.Size() == after.Size() && before.ModTime().Equal(after.ModTime()) && before.Mode() == after.Mode() && (!local || os.SameFile(before, after))
}

func (a *AppService) ResumeTransfer(id, workspace string) (Transfer, error) {
	a.mu.Lock()
	previous := a.transfers[id]
	owner := a.workspaces[workspace]
	if previous == nil || previous.resume == nil || previous.resumeClaimed || previous.spec == nil || (previous.view.State != "failed" && previous.view.State != "cancelled") {
		a.mu.Unlock()
		return Transfer{}, errors.New("此任务没有可续传数据")
	}
	if owner == nil || owner.target != previous.view.Target || owner.identity != previous.peerIdentity {
		a.mu.Unlock()
		return Transfer{}, errors.New("请选择目标、用户、主机身份及跳板均一致的已连接工作区")
	}
	state := previous.resume
	spec := *previous.spec
	spec.workspace = workspace
	spec.resume = state
	previous.resumeClaimed = true
	a.mu.Unlock()
	run := func(ctx context.Context, report func(int64, int64)) error {
		return a.resumeTransferOperation(ctx, workspace, spec, state, report)
	}
	view, err := a.startTransfer(workspace, path.Base(spec.remote), spec.direction, state.source.Size(), run, spec)
	a.mu.Lock()
	previous.resumeClaimed = false
	if err == nil {
		previous.resume = nil
		previous.view.Resumable = false
		previous.view.ResumePersisted = false
		previous.view.TemporaryPath = ""
		a.transferEvent(previous.view)
	}
	a.mu.Unlock()
	if err == nil {
		if persistErr := a.persistTransferResumes(); persistErr != nil {
			return view, fmt.Errorf("续传已入队，但旧记录更新失败：%w", persistErr)
		}
	}
	return view, err
}

func (a *AppService) resumeTransferOperation(ctx context.Context, workspace string, spec transferSpec, state *transferResume, report func(int64, int64)) error {
	if spec.direction == "upload" {
		if err := a.requireFileWrite(workspace); err != nil {
			return err
		}
	}
	var restoreErr error
	var restored os.FileInfo
	if spec.direction == "upload" {
		restored, restoreErr = restoreLocalTransferFile(state.source, spec.local)
		if restoreErr == nil {
			state.source = restored
		}
	} else {
		restored, restoreErr = restoreLocalTransferFile(state.before, spec.local)
		if restoreErr == nil {
			state.before = restored
		}
		if restoreErr == nil && state.partial != nil {
			_, restoreErr = restoreLocalTransferFile(state.partial, state.temporary)
			if restoreErr == nil {
				state.partial = nil
			}
		}
	}
	if restoreErr != nil {
		return restoreErr
	}
	client, release, err := a.fileClient(ctx, workspace)
	if err != nil {
		return err
	}
	defer release()
	var source io.ReadSeekCloser
	var target io.WriteCloser
	var current os.FileInfo
	var destination os.FileInfo
	if spec.direction == "upload" {
		file, err := os.Open(spec.local)
		if err != nil {
			return err
		}
		defer file.Close()
		current, err = file.Stat()
		if err != nil {
			return err
		}
		if !sameTransferVersion(state.source, current, true) {
			return errors.New("本地源文件已变化，续传已阻止")
		}
		destination, err = client.Lstat(spec.remote)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		if !sameTransferVersion(state.before, destination, false) {
			return errors.New("远端目标自中断后已变化")
		}
		partial, err := client.Lstat(state.temporary)
		if err != nil {
			return err
		}
		if !partial.Mode().IsRegular() || partial.Size() != state.offset {
			return errors.New("远端暂存长度或类型已变化")
		}
		output, err := client.OpenFile(state.temporary, os.O_WRONLY)
		if err != nil {
			return err
		}
		defer output.Close()
		if _, err = output.Seek(state.offset, io.SeekStart); err != nil {
			return err
		}
		source, target = file, output
	} else {
		current, err = client.Lstat(spec.remote)
		if err != nil {
			return err
		}
		if !sameTransferVersion(state.source, current, false) {
			return errors.New("远端源文件已变化，续传已阻止")
		}
		destination, err = os.Lstat(spec.local)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		if !sameTransferVersion(state.before, destination, true) {
			return errors.New("本地目标自中断后已变化")
		}
		partial, err := os.Lstat(state.temporary)
		if err != nil {
			return err
		}
		if !partial.Mode().IsRegular() || partial.Size() != state.offset {
			return errors.New("本地暂存长度或类型已变化")
		}
		file, err := client.Open(spec.remote)
		if err != nil {
			return err
		}
		defer file.Close()
		output, err := os.OpenFile(state.temporary, os.O_WRONLY, 0600)
		if err != nil {
			return err
		}
		defer output.Close()
		if _, err = output.Seek(state.offset, io.SeekStart); err != nil {
			return err
		}
		source, target = file, output
	}
	if _, err = source.Seek(state.offset, io.SeekStart); err != nil {
		return err
	}
	report(state.offset, state.source.Size())
	writer := &transferWriter{ctx: ctx, writer: target, report: report, total: state.source.Size(), completed: state.offset, limit: a.transferRate.Load}
	_, err = io.CopyBuffer(writer, source, make([]byte, 64<<10))
	state.offset = writer.completed
	if err != nil {
		return err
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	if spec.direction == "upload" {
		latest, err := os.Stat(spec.local)
		if err != nil || !sameTransferVersion(state.source, latest, true) {
			return errors.Join(err, errors.New("上传源文件在续传期间已变化"))
		}
		latest, err = client.Lstat(spec.remote)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		if !sameTransferVersion(state.before, latest, false) {
			return errors.New("远端目标在续传期间已变化")
		}
		if err = target.(*sftp.File).Chmod(state.source.Mode().Perm()); err != nil {
			return err
		}
		if err = target.Close(); err != nil {
			return err
		}
		if err = client.Chtimes(state.temporary, state.source.ModTime(), state.source.ModTime()); err != nil {
			return err
		}
		if state.before == nil {
			err = client.Rename(state.temporary, spec.remote)
		} else {
			err = client.PosixRename(state.temporary, spec.remote)
		}
		if err != nil {
			return err
		}
		a.finishTransferResume(ctx)
		if err := files.RemoveStaging(client, state.staging); err != nil {
			a.retainTransferCleanup(ctx, state.staging)
			return fmt.Errorf("文件已发布，暂存目录清理失败：%w", err)
		}
	} else {
		latest, err := client.Lstat(spec.remote)
		if err != nil || !sameTransferVersion(state.source, latest, false) {
			return errors.Join(err, errors.New("远端源文件在续传期间已变化"))
		}
		latest, err = os.Lstat(spec.local)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		if !sameTransferVersion(state.before, latest, true) {
			return errors.New("本地目标在续传期间已变化")
		}
		if err = target.(*os.File).Sync(); err != nil {
			return err
		}
		if err = target.Close(); err != nil {
			return err
		}
		if err = os.Chtimes(state.temporary, state.source.ModTime(), state.source.ModTime()); err != nil {
			return err
		}
		if state.before == nil {
			if err = os.Link(state.temporary, spec.local); err != nil {
				return err
			}
			a.finishTransferResume(ctx)
			if err = os.Remove(state.temporary); err != nil {
				return fmt.Errorf("文件已下载，暂存清理失败：%w", err)
			}
		} else {
			if err = os.Rename(state.temporary, spec.local); err != nil {
				return err
			}
			a.finishTransferResume(ctx)
		}
	}
	return nil
}

func (a *AppService) finishTransferResume(ctx context.Context) {
	task, _ := ctx.Value(transferContextKey{}).(*transferTask)
	if task != nil {
		a.mu.Lock()
		task.resume = nil
		a.mu.Unlock()
	}
}

func (a *AppService) DiscardTransferResume(id, workspace string) error {
	a.mu.Lock()
	task := a.transfers[id]
	if task == nil || task.spec == nil || (task.resume == nil && task.cleanupStaging == "") || task.resumeClaimed || task.view.State == "running" || task.view.State == "queued" {
		a.mu.Unlock()
		return errors.New("暂存任务已失效或仍在执行")
	}
	state, spec := task.resume, *task.spec
	staging := task.cleanupStaging
	if state != nil {
		staging = state.staging
	}
	if spec.direction == "upload" {
		owner := a.workspaces[workspace]
		if owner == nil || owner.target != task.view.Target || owner.identity != task.peerIdentity {
			a.mu.Unlock()
			return errors.New("清理远端暂存需要同一目标的已连接工作区")
		}
		if owner.browseOnly {
			a.mu.Unlock()
			return errors.New("当前工作区处于文件浏览模式，请先允许文件写入")
		}
	}
	task.resumeClaimed = true
	a.mu.Unlock()
	var err error
	if spec.direction == "upload" {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		client, release, openErr := a.fileClient(ctx, workspace)
		if openErr != nil {
			err = openErr
		} else {
			err = files.RemoveStaging(client, staging)
			release()
		}
	} else {
		if state.partial != nil {
			_, err = restoreLocalTransferFile(state.partial, state.temporary)
		}
		if err == nil {
			err = os.Remove(state.temporary)
		}
		if os.IsNotExist(err) {
			err = nil
		}
	}
	if os.IsNotExist(err) {
		err = nil
	}
	a.mu.Lock()
	task.resumeClaimed = err == nil
	a.mu.Unlock()
	if err == nil {
		err = a.persistTransferResumes()
		a.mu.Lock()
		task.resumeClaimed = false
		if err == nil {
			delete(a.transfers, id)
		}
		a.mu.Unlock()
	}
	return err
}

func (a *AppService) cleanupLocalTransferResumes() error {
	a.mu.Lock()
	paths := []string{}
	for _, task := range a.transfers {
		if task.resume != nil && task.spec != nil && task.spec.direction == "download" && !task.view.ResumePersisted {
			paths = append(paths, task.resume.temporary)
		}
	}
	a.mu.Unlock()
	var result error
	for _, filename := range paths {
		if err := os.Remove(filename); err != nil && !os.IsNotExist(err) {
			result = errors.Join(result, err)
		}
	}
	return result
}
