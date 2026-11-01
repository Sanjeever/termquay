package main

import (
	"context"
	"errors"
	"path"

	"github.com/Sanjeever/termquay/internal/files"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"github.com/pkg/sftp"
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

func (a *AppService) ReadDirectory(ctx context.Context, id, remote string) ([]files.Entry, error) {
	c, close, err := a.fileClient(ctx, id)
	if err != nil {
		return nil, err
	}
	defer close()
	return files.List(ctx, c, remote)
}
func (a *AppService) ReadRemoteFile(ctx context.Context, id, remote string) (files.Document, error) {
	c, close, err := a.fileClient(ctx, id)
	if err != nil {
		return files.Document{}, err
	}
	defer close()
	return files.Read(c, remote)
}
func (a *AppService) SaveRemoteFile(ctx context.Context, id string, document files.Document) (files.Document, error) {
	c, close, err := a.fileClient(ctx, id)
	if err != nil {
		return files.Document{}, err
	}
	defer close()
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
	info, err := c.Lstat(remote)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return c.RemoveDirectory(remote)
	}
	return c.Remove(remote)
}
