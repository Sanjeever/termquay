package app

import (
	"context"
	"errors"

	"io"
	"os"
	"path"
	"path/filepath"
	"time"

	remotefiles "github.com/Sanjeever/termquay/internal/files"
	appmessage "github.com/Sanjeever/termquay/internal/message"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func (a *AppService) StartUpload(id, directory string) (Transfer, error) {
	local, err := application.Get().Dialog.OpenFile().SetTitle(nativeText("Select upload files", "选择上传文件")).PromptForSingleSelection()
	if err != nil || local == "" {
		return Transfer{}, err
	}
	return a.uploadPath(id, local, path.Join(directory, filepath.Base(local)), false)
}
func (a *AppService) StartUploads(id, directory string, overwrite bool) (TransferBatch, error) {
	paths, err := application.Get().Dialog.OpenFile().SetTitle(nativeText("Select upload files", "选择上传文件")).PromptForMultipleSelection()
	if err != nil {
		return TransferBatch{}, err
	}
	return a.uploadFiles(id, directory, paths, overwrite)
}
func (a *AppService) uploadFiles(id, directory string, locals []string, overwrite bool) (TransferBatch, error) {
	if len(locals) > 64 || !path.IsAbs(directory) {
		return TransferBatch{}, appmessage.New("backend:uploadDirectoryInvalidOrMoreThan64Files", "上传目录无效或文件超过 64 个")
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
	if err := a.requireFileWrite(id); err != nil {
		return 0, nil, err
	}
	if !filepath.IsAbs(local) || !path.IsAbs(remote) || len(local) > 4096 || len(remote) > 4096 {
		return 0, nil, appmessage.New("backend:invalidTransferPath", "传输路径无效")
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
		return 0, nil, appmessage.New("backend:uploadsSupportRegularFiles", "上传支持普通文件")
	}
	return info.Size(), func(ctx context.Context, report func(int64, int64)) (result error) {
		c, close, err := a.fileWriteClient(ctx, id)
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
				return appmessage.New("backend:overwriteDestinationMustBeARegularFile", "覆盖目标必须是普通文件")
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
			return appmessage.New("backend:localSourceFileChangedRetryExplicitly", "本地源文件已变化，请显式重试")
		}
		staging, err := remotefiles.CreateStaging(c, path.Dir(remote))
		if err != nil {
			return err
		}
		temporary := path.Join(staging, "data")
		target, err := c.OpenFile(temporary, os.O_CREATE|os.O_EXCL|os.O_WRONLY)
		if err != nil {
			cleanupErr := remotefiles.RemoveStaging(c, staging)
			if cleanupErr != nil {
				a.retainTransferCleanup(ctx, staging)
			}
			return errors.Join(err, cleanupErr)
		}
		retained := false
		defer func() {
			target.Close()
			if retained {
				return
			}
			if ctx.Err() == nil {
				cleanupErr := remotefiles.RemoveStaging(c, staging)
				if cleanupErr != nil {
					a.retainTransferCleanup(ctx, staging)
				}
				if result == nil && cleanupErr != nil {
					result = appmessage.Errorf("backend:fileUploadedButTemporaryDirectoryCleanupFailed", "文件已上传，但临时目录清理失败: %w", cleanupErr)
				} else {
					result = errors.Join(result, cleanupErr)
				}
				return
			}
			cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			cleanup, err := owner.FileClient(cleanupCtx)
			if err != nil {
				a.retainTransferCleanup(ctx, staging)
				result = errors.Join(result, errors.New("远端临时目录可能残留: "+staging))
				return
			}
			defer cleanup.Close()
			if err = remotefiles.RemoveStaging(cleanup, staging); err != nil {
				a.retainTransferCleanup(ctx, staging)
				result = errors.Join(result, err)
			}
		}()
		writer := &transferWriter{ctx: ctx, writer: target, report: report, total: info.Size(), limit: a.transferRate.Load}
		report(0, info.Size())
		if _, err = io.CopyBuffer(writer, source, make([]byte, 64<<10)); err != nil {
			retained = a.retainTransfer(ctx, &transferResume{source: info, before: before, offset: writer.completed, temporary: temporary, staging: staging})
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
			return appmessage.New("backend:localSourceFileChangedDuringUpload", "上传期间本地源文件已变化")
		}
		latest, err := c.Lstat(remote)
		if before == nil {
			if err == nil {
				return appmessage.New("backend:destinationAppearedDuringUploadPublicationBlocked", "目标在上传期间出现，发布已阻止")
			}
			if !os.IsNotExist(err) {
				return err
			}
		} else {
			if err != nil {
				return err
			}
			if before.Size() != latest.Size() || !before.ModTime().Equal(latest.ModTime()) || before.Mode() != latest.Mode() {
				return appmessage.New("backend:destinationChangedDuringUploadOverwriteBlocked", "目标在上传期间已变化，覆盖已阻止")
			}
		}
		if before != nil {
			err = c.PosixRename(temporary, remote)
		} else {
			err = c.Rename(temporary, remote)
		}
		if err != nil {
			return appmessage.Errorf("backend:uploadPublicationFailed", "上传发布失败: %w", err)
		}
		return nil
	}, nil
}
