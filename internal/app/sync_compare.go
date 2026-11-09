package app

import (
	"bytes"
	"context"
	"crypto/sha256"

	"io"
	"os"
	"path"
	"path/filepath"
	"time"

	"github.com/Sanjeever/termquay/internal/files"
	appmessage "github.com/Sanjeever/termquay/internal/message"
)

type SyncContentComparison struct {
	Path  string `json:"path"`
	Equal bool   `json:"equal"`
	State string `json:"state"`
}

func (a *AppService) CompareDirectorySyncFile(ctx context.Context, id, relative string) (SyncContentComparison, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	a.mu.Lock()
	plan := a.syncPlans[id]
	if plan == nil || plan.executing || time.Now().After(plan.expires) {
		a.mu.Unlock()
		return SyncContentComparison{}, appmessage.New("backend:syncPreviewExpired", "同步预览已失效")
	}
	source, sourceOK := plan.source[relative]
	target, targetOK := plan.target[relative]
	if !sourceOK || !targetOK || !source.Mode.IsRegular() || !target.Mode.IsRegular() {
		a.mu.Unlock()
		return SyncContentComparison{}, appmessage.New("backend:contentComparisonRequiresRegularFilesOnBothSides", "内容比较需要两端均存在普通文件")
	}
	if source.Size > 16<<20 || target.Size > 16<<20 {
		a.mu.Unlock()
		return SyncContentComparison{}, appmessage.New("backend:onDemandContentComparisonSupportsFilesWithin16", "按需内容比较支持 16 MiB 内文件")
	}
	a.mu.Unlock()
	client, release, err := a.fileClient(ctx, plan.workspace)
	if err != nil {
		return SyncContentComparison{}, err
	}
	defer release()
	local, err := os.Open(filepath.Join(plan.preview.Local, filepath.FromSlash(relative)))
	if err != nil {
		return SyncContentComparison{}, err
	}
	defer local.Close()
	remote, err := client.Open(path.Join(plan.preview.Remote, relative))
	if err != nil {
		return SyncContentComparison{}, err
	}
	defer remote.Close()
	localExpected, remoteExpected := source, target
	if plan.preview.Direction == "download" {
		localExpected, remoteExpected = target, source
	}
	check := func() error {
		localInfo, err := local.Stat()
		if err != nil {
			return err
		}
		remoteInfo, err := remote.Stat()
		if err != nil {
			return err
		}
		if !files.SameSyncNode(localExpected, files.SyncInfo(localInfo)) || !files.SameSyncNode(remoteExpected, files.SyncInfo(remoteInfo)) {
			return appmessage.New("backend:fileChangedAfterSyncPreviewPreviewAgain", "文件自同步预览后已变化，请重新预览")
		}
		return nil
	}
	if err := check(); err != nil {
		return SyncContentComparison{}, err
	}
	left, right := sha256.New(), sha256.New()
	if _, err := io.CopyBuffer(left, io.NewSectionReader(local, 0, localExpected.Size), make([]byte, 64<<10)); err != nil {
		return SyncContentComparison{}, err
	}
	if err := ctx.Err(); err != nil {
		return SyncContentComparison{}, err
	}
	if _, err := io.CopyBuffer(right, io.NewSectionReader(remote, 0, remoteExpected.Size), make([]byte, 64<<10)); err != nil {
		return SyncContentComparison{}, err
	}
	if err := check(); err != nil {
		return SyncContentComparison{}, err
	}
	result := SyncContentComparison{Path: relative, Equal: bytes.Equal(left.Sum(nil), right.Sum(nil))}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.syncPlans[id] != plan || plan.executing || time.Now().After(plan.expires) {
		return SyncContentComparison{}, appmessage.New("backend:syncPreviewExpired", "同步预览已失效")
	}
	for index, entry := range plan.preview.Entries {
		if entry.Path == relative {
			if !result.Equal && entry.State == "same" {
				plan.preview.Entries[index].State = "update"
			}
			result.State = plan.preview.Entries[index].State
			break
		}
	}
	return result, nil
}
