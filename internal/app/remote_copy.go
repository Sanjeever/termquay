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
	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"github.com/pkg/sftp"
)

func (a *AppService) CopyRemoteFile(ctx context.Context, sourceID, sourcePath, targetID, targetPath string, overwrite bool) (Transfer, error) {
	if err := validateRemotePaths([]string{sourcePath}); err != nil {
		return Transfer{}, err
	}
	if err := validateRemotePaths([]string{targetPath}); err != nil {
		return Transfer{}, err
	}
	sourceOwner, err := a.terminal(sourceID)
	if err != nil {
		return Transfer{}, err
	}
	targetOwner, err := a.terminal(targetID)
	if err != nil {
		return Transfer{}, err
	}
	source, release, err := a.fileClient(ctx, sourceID)
	if err != nil {
		return Transfer{}, err
	}
	info, err := source.Lstat(sourcePath)
	release()
	if err != nil {
		return Transfer{}, err
	}
	if !info.Mode().IsRegular() || info.Mode()&(os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != 0 {
		return Transfer{}, errors.New("跨工作区复制支持无特殊权限位的普通文件")
	}
	run := a.remoteCopyOperation(sourceID, sourcePath, targetID, targetPath, overwrite, sourceOwner, targetOwner, info, nil)
	return a.startTransfer(targetID, path.Base(sourcePath)+" → "+path.Base(targetPath), "copy", info.Size(), run, transferSpec{workspace: targetID, remote: sourcePath, local: targetPath, direction: "copy"})
}

func (a *AppService) remoteCopyOperation(sourceID, sourcePath, targetID, targetPath string, overwrite bool, sourceOwner, targetOwner *terminal.Terminal, info os.FileInfo, expected *transferExpectation) func(context.Context, func(int64, int64)) error {
	return func(ctx context.Context, report func(int64, int64)) (result error) {
		if !info.Mode().IsRegular() || info.Mode()&(os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != 0 {
			return errors.New("复制支持无特殊权限位的普通文件")
		}
		ctx, cancel := context.WithCancel(ctx)
		defer cancel()
		a.mu.Lock()
		sourceWorkspace := a.workspaces[sourceID]
		a.mu.Unlock()
		if sourceWorkspace == nil {
			return errors.New("来源工作区已关闭")
		}
		stopSource := context.AfterFunc(sourceWorkspace.ctx, cancel)
		defer stopSource()
		currentSource, err := a.terminal(sourceID)
		if err != nil {
			return err
		}
		currentTarget, err := a.terminal(targetID)
		if err != nil {
			return err
		}
		if currentSource != sourceOwner || currentTarget != targetOwner {
			return errors.New("复制所属连接已变化")
		}
		s, releaseSource, err := a.fileClient(ctx, sourceID)
		if err != nil {
			return err
		}
		defer releaseSource()
		d, releaseTarget, err := a.fileClient(ctx, targetID)
		if err != nil {
			return err
		}
		defer releaseTarget()
		canonicalSource, err := s.RealPath(sourcePath)
		if err != nil {
			return err
		}
		canonicalParent, err := d.RealPath(path.Dir(targetPath))
		if err != nil {
			return err
		}
		if sourceID == targetID && canonicalSource == path.Join(canonicalParent, path.Base(targetPath)) {
			return errors.New("源文件与目标相同")
		}
		before, err := d.Lstat(targetPath)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		if expected != nil {
			if expected.targetExists && (before == nil || !files.SameSyncNode(files.SyncInfo(before), expected.target)) || !expected.targetExists && before != nil {
				return errors.New("目标自预览后已变化")
			}
		}
		if before != nil && (!overwrite || !before.Mode().IsRegular()) {
			return errors.New("同名目标已存在或不是普通文件")
		}
		if before != nil && before.Mode()&(os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != 0 {
			return errors.New("不能覆盖含特殊权限位的文件")
		}
		if before != nil {
			if _, ok := d.HasExtension("posix-rename@openssh.com"); !ok {
				return errors.New("服务端不支持安全覆盖")
			}
		}
		current, err := s.Lstat(sourcePath)
		if err != nil {
			return err
		}
		if !files.SameSyncNode(files.SyncInfo(info), files.SyncInfo(current)) {
			return errors.New("源文件已变化，请重新提交复制")
		}
		input, err := s.Open(sourcePath)
		if err != nil {
			return err
		}
		defer input.Close()
		staging, err := files.CreateStaging(d, path.Dir(targetPath))
		if err != nil {
			return err
		}
		defer func() {
			cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			defer cancel()
			client, err := targetOwner.FileClient(cleanup)
			if err == nil {
				err = files.RemoveStaging(client, staging)
				client.Close()
			}
			if err != nil {
				result = errors.Join(result, fmt.Errorf("远端暂存清理失败 %s: %w", staging, err))
			}
		}()
		temporary := path.Join(staging, "data")
		output, err := d.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL)
		if err != nil {
			return err
		}
		defer output.Close()
		writer := &transferWriter{ctx: ctx, writer: output, report: report, total: info.Size(), limit: a.transferRate.Load}
		report(0, info.Size())
		n, err := io.CopyBuffer(writer, io.LimitReader(input, info.Size()+1), make([]byte, 64<<10))
		if err != nil {
			return err
		}
		if n != info.Size() {
			return errors.New("复制期间源文件大小已变化")
		}
		mode := info.Mode().Perm()
		if before != nil {
			mode = before.Mode().Perm()
			attributes, ok := before.Sys().(*sftp.FileStat)
			if !ok {
				return errors.New("目标未提供可识别的所有者属性")
			}
			if err = output.Chown(int(attributes.UID), int(attributes.GID)); err != nil {
				return err
			}
		}
		if err = output.Chmod(mode); err != nil {
			return err
		}
		if err = output.Close(); err != nil {
			return err
		}
		if err = d.Chtimes(temporary, info.ModTime(), info.ModTime()); err != nil {
			return err
		}
		current, err = s.Lstat(sourcePath)
		if err != nil {
			return err
		}
		if !files.SameSyncNode(files.SyncInfo(info), files.SyncInfo(current)) {
			return errors.New("复制期间源文件已变化")
		}
		latest, err := d.Lstat(targetPath)
		if before == nil {
			if !os.IsNotExist(err) {
				return errors.New("复制期间目标出现或无法核对，发布已阻止")
			}
		} else if err != nil || !files.SameSyncNode(files.SyncInfo(before), files.SyncInfo(latest)) {
			return errors.New("复制期间目标已变化")
		}
		if err = ctx.Err(); err != nil {
			return err
		}
		if before != nil {
			return d.PosixRename(temporary, targetPath)
		}
		return d.Rename(temporary, targetPath)
	}
}
