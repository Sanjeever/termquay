package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func (a *AppService) StartDownload(id, remote string) (Transfer, error) {
	local, err := application.Get().Dialog.SaveFile().SetMessage(nativeText("Save downloaded file", "保存下载文件")).SetFilename(path.Base(remote)).PromptForSingleSelection()
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
	directory, err := application.Get().Dialog.OpenFile().SetTitle(nativeText("Select download directory", "选择下载目录")).CanChooseFiles(false).CanChooseDirectories(true).PromptForSingleSelection()
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
		retained := false
		defer func() {
			target.Close()
			if !published && !retained {
				result = errors.Join(result, os.Remove(target.Name()))
			}
		}()
		writer := &transferWriter{ctx: ctx, writer: target, report: report, total: info.Size(), limit: a.transferRate.Load}
		report(0, info.Size())
		if _, err = io.CopyBuffer(writer, source, make([]byte, 64<<10)); err != nil {
			retained = a.retainTransfer(ctx, &transferResume{source: info, before: before, offset: writer.completed, temporary: target.Name()})
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
