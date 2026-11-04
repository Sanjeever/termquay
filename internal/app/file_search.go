package app

import (
	"context"
	"errors"
	"time"

	"github.com/Sanjeever/termquay/internal/files"
)

func (a *AppService) SearchRemoteFiles(ctx context.Context, workspace string, options files.SearchOptions) (files.SearchResult, error) {
	if err := options.Validate(); err != nil {
		return files.SearchResult{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	a.mu.Lock()
	owner := a.workspaces[workspace]
	if owner == nil || a.closed {
		a.mu.Unlock()
		return files.SearchResult{}, errors.New("SSH 工作区已关闭")
	}
	a.mu.Unlock()
	stopOwner := context.AfterFunc(owner.ctx, cancel)
	defer stopOwner()
	select {
	case a.fileSlots <- struct{}{}:
	case <-ctx.Done():
		return files.SearchResult{}, ctx.Err()
	}
	defer func() { <-a.fileSlots }()
	client, err := owner.terminal.DirectoryClient(ctx)
	if err != nil {
		return files.SearchResult{}, err
	}
	defer client.Close()
	stop := context.AfterFunc(ctx, func() { client.Close() })
	defer stop()
	return files.Search(ctx, client, options)
}
