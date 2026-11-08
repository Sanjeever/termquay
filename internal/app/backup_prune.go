package app

import (
	"context"
	"encoding/base64"
	"errors"
	"time"

	"github.com/Sanjeever/termquay/internal/backup"
)

type SnapshotPrunePreview struct {
	ID        string                 `json:"id"`
	DeviceID  string                 `json:"device_id"`
	Retained  []backup.PruneSnapshot `json:"retained"`
	Removed   []backup.PruneSnapshot `json:"removed"`
	Bytes     int64                  `json:"bytes"`
	Remaining int                    `json:"remaining"`
	Skipped   int                    `json:"skipped"`
	options   backup.WebDAVOptions
	expires   time.Time
}

func (a *AppService) ListBackupDevices(ctx context.Context) ([]string, error) {
	config, err := a.savedBackupConfig()
	if err != nil {
		return nil, err
	}
	return config.Options.Devices(ctx)
}

func (a *AppService) CancelSnapshotPrune(id string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.snapshotPruneID == id && a.snapshotPruneCancel != nil {
		a.snapshotPruneCancel()
	}
}

func (a *AppService) PreviewSnapshotPrune(ctx context.Context, device string, keep int) (SnapshotPrunePreview, error) {
	a.backupMu.Lock()
	defer a.backupMu.Unlock()
	a.snapshotPrune = nil
	config, err := a.savedBackupConfig()
	if err != nil {
		return SnapshotPrunePreview{}, err
	}
	retained, removed, remaining, skipped, err := config.Options.PlanPrune(ctx, device, keep)
	if err != nil {
		return SnapshotPrunePreview{}, err
	}
	p := SnapshotPrunePreview{ID: base64.RawURLEncoding.EncodeToString(randomBytes(18)), DeviceID: device, Retained: retained, Removed: removed, Remaining: remaining, Skipped: skipped, options: config.Options, expires: time.Now().Add(10 * time.Minute)}
	for _, item := range removed {
		p.Bytes += item.Size
	}
	a.snapshotPrune = &p
	return p, nil
}

type SnapshotPruneResult struct {
	Path  string `json:"path"`
	State string `json:"state"`
	Error string `json:"error"`
}

func (a *AppService) ConfirmSnapshotPrune(ctx context.Context, id string) ([]SnapshotPruneResult, error) {
	a.backupMu.Lock()
	defer a.backupMu.Unlock()
	p := a.snapshotPrune
	if p == nil || p.ID != id || time.Now().After(p.expires) {
		return nil, errors.New("清理预览已失效")
	}
	config, err := a.savedBackupConfig()
	if err != nil {
		return nil, err
	}
	if config.Options != p.options {
		return nil, errors.New("备份位置或登录配置已变化，请重新预览")
	}
	if len(p.Removed) == 0 {
		a.snapshotPrune = nil
		return []SnapshotPruneResult{}, nil
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	a.mu.Lock()
	a.snapshotPruneCancel = cancel
	a.snapshotPruneID = id
	a.mu.Unlock()
	defer func() { a.mu.Lock(); a.snapshotPruneCancel = nil; a.snapshotPruneID = ""; a.mu.Unlock() }()
	retained, _, _, _, err := p.options.PlanPrune(ctx, p.DeviceID, len(p.Retained))
	if err != nil {
		return nil, err
	}
	if len(retained) < len(p.Retained) {
		return nil, errors.New("保留快照已变化，请重新预览")
	}
	for _, keep := range retained {
		for _, item := range p.Removed {
			if keep.Path == item.Path {
				return nil, errors.New("待删除快照已进入保留范围，请重新预览")
			}
		}
	}
	a.snapshotPrune = nil
	results := []SnapshotPruneResult{}
	stopped := false
	for _, item := range p.Removed {
		result := SnapshotPruneResult{Path: item.Path, State: "not_run"}
		if !stopped {
			if err := ctx.Err(); err != nil {
				result.Error = err.Error()
				stopped = true
			} else if err := p.options.DeletePreviewedSnapshot(ctx, item); err != nil {
				result.State = "failed"
				result.Error = err.Error()
				stopped = true
			} else {
				result.State = "done"
			}
		}
		results = append(results, result)
	}
	return results, nil
}
