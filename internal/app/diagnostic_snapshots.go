package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"time"

	"github.com/Sanjeever/termquay/internal/monitor"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type DiagnosticCaptureOptions struct {
	System       bool     `json:"system"`
	FileSystems  bool     `json:"file_systems"`
	Processes    bool     `json:"processes"`
	Ports        bool     `json:"ports"`
	Containers   bool     `json:"containers"`
	DockerSocket string   `json:"docker_socket"`
	Services     []string `json:"services"`
	ServiceLogs  bool     `json:"service_logs"`
	Logs         []string `json:"logs"`
}

type DiagnosticSection struct {
	Kind      string    `json:"kind"`
	Name      string    `json:"name"`
	Time      time.Time `json:"time"`
	Content   string    `json:"content"`
	Error     string    `json:"error"`
	Truncated bool      `json:"truncated"`
}

type DiagnosticSnapshotInfo struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	Time     time.Time `json:"time"`
	Target   string    `json:"target"`
	Identity string    `json:"identity"`
}

type DiagnosticSnapshot struct {
	Version  int                    `json:"version"`
	Info     DiagnosticSnapshotInfo `json:"info"`
	Sections []DiagnosticSection    `json:"sections"`
}

func (a *AppService) CaptureDiagnosticSnapshot(ctx context.Context, workspace string, options DiagnosticCaptureOptions) (DiagnosticSnapshot, error) {
	if len(options.Services) > 8 || len(options.Logs) > 8 {
		return DiagnosticSnapshot{}, errors.New("每次最多选择 8 个服务和 8 个日志文件")
	}
	seenServices := map[string]bool{}
	for _, unit := range options.Services {
		if !validServiceUnit(unit) {
			return DiagnosticSnapshot{}, errors.New("服务名称无效")
		}
		if seenServices[unit] {
			return DiagnosticSnapshot{}, errors.New("服务名称重复")
		}
		seenServices[unit] = true
	}
	if len(options.Logs) > 0 {
		if err := validateRemotePaths(options.Logs); err != nil {
			return DiagnosticSnapshot{}, err
		}
	}
	a.mu.Lock()
	owner := a.workspaces[workspace]
	if owner == nil || a.snapshotCapturing || a.closed {
		a.mu.Unlock()
		return DiagnosticSnapshot{}, errors.New("工作区已关闭或已有排障快照正在采集")
	}
	a.snapshotCapturing = true
	info := DiagnosticSnapshotInfo{ID: base64.RawURLEncoding.EncodeToString(randomBytes(16)), Name: "排障快照", Time: time.Now().UTC(), Target: owner.target, Identity: owner.identity}
	a.mu.Unlock()
	defer func() { a.mu.Lock(); a.snapshotCapturing = false; a.mu.Unlock() }()
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	stop := context.AfterFunc(owner.ctx, cancel)
	defer stop()
	snapshot := DiagnosticSnapshot{Version: 1, Info: info, Sections: []DiagnosticSection{}}
	bytes := 0
	add := func(kind, name string, collect func() (any, bool, error)) {
		section := DiagnosticSection{Kind: kind, Name: name, Time: time.Now().UTC()}
		if err := ctx.Err(); err != nil {
			section.Error = err.Error()
		} else {
			value, truncated, err := collect()
			section.Truncated = truncated
			if err != nil {
				section.Error = err.Error()
			}
			if value != nil {
				data, encodeErr := json.MarshalIndent(value, "", "  ")
				if encodeErr != nil {
					section.Error = errors.Join(err, encodeErr).Error()
				} else if len(data)+bytes > 2<<20 {
					section.Error = "快照正文达到 2 MiB 上限，本项未收录"
					section.Truncated = true
				} else {
					section.Content = string(data)
					bytes += len(data)
				}
			}
		}
		snapshot.Sections = append(snapshot.Sections, section)
	}
	if options.System {
		add("system", "系统与资源", func() (any, bool, error) {
			first, err := a.inspectLinux(ctx, workspace, monitor.Script)
			if err != nil {
				return nil, first.Truncated, err
			}
			if first.Truncated {
				return nil, true, errors.New("系统采样输出已截断")
			}
			previous, err := monitor.Parse([]byte(first.Stdout), time.Now(), nil)
			if err != nil {
				return nil, false, err
			}
			timer := time.NewTimer(500 * time.Millisecond)
			defer timer.Stop()
			select {
			case <-ctx.Done():
				return nil, false, ctx.Err()
			case <-timer.C:
			}
			second, err := a.inspectLinux(ctx, workspace, monitor.Script)
			if err != nil {
				return nil, second.Truncated, err
			}
			if second.Truncated {
				return nil, true, errors.New("系统采样输出已截断")
			}
			sample, err := monitor.Parse([]byte(second.Stdout), time.Now(), &previous)
			return sample, false, err
		})
	}
	if options.FileSystems {
		add("filesystems", "文件系统", func() (any, bool, error) {
			result, err := a.inspectLinux(ctx, workspace, monitor.FileSystemScript)
			if err != nil || result.Truncated {
				return nil, result.Truncated, err
			}
			items, err := monitor.ParseFileSystems([]byte(result.Stdout))
			return items, false, err
		})
	}
	if options.Processes {
		add("processes", "进程", func() (any, bool, error) {
			value, err := a.ListLinuxProcesses(ctx, workspace, "cpu")
			if err != nil {
				return nil, value.Truncated, err
			}
			return value, value.Truncated, nil
		})
	}
	if options.Ports {
		add("ports", "监听端口", func() (any, bool, error) {
			value, err := a.ListLinuxPorts(ctx, workspace)
			if err != nil {
				return nil, value.Truncated, err
			}
			return value, value.Truncated, nil
		})
	}
	if options.Containers {
		add("containers", "Docker 容器", func() (any, bool, error) {
			value, err := a.ListContainers(ctx, workspace, options.DockerSocket)
			return value, false, err
		})
	}
	for _, unit := range options.Services {
		add("service", unit, func() (any, bool, error) {
			value, err := a.ReadLinuxServiceDetails(ctx, workspace, unit)
			if err != nil {
				return nil, false, err
			}
			return value, false, nil
		})
		if options.ServiceLogs {
			add("service-log", unit, func() (any, bool, error) {
				value, err := a.ReadLinuxServiceLog(ctx, workspace, unit)
				if err != nil {
					return nil, value.Truncated, err
				}
				return value, value.Truncated, nil
			})
		}
	}
	for _, filename := range options.Logs {
		add("log", filename, func() (any, bool, error) {
			value, err := a.ReadRemoteLog(ctx, workspace, filename, -1, false)
			if err != nil {
				return nil, false, err
			}
			return value, value.Start > 0, nil
		})
	}
	if len(snapshot.Sections) == 0 {
		return DiagnosticSnapshot{}, errors.New("请至少选择一项采集内容")
	}
	return snapshot, nil
}

func validateDiagnosticSnapshot(snapshot DiagnosticSnapshot) ([]byte, error) {
	if snapshot.Version != 1 || !validWorkspaceID(snapshot.Info.ID) || strings.TrimSpace(snapshot.Info.Name) == "" || len(snapshot.Info.Name) > 128 || snapshot.Info.Time.IsZero() || len(snapshot.Info.Target) > 1024 || len(snapshot.Info.Identity) > 4096 || len(snapshot.Sections) == 0 || len(snapshot.Sections) > 32 {
		return nil, errors.New("排障快照版本、名称或项目数量无效")
	}
	for _, section := range snapshot.Sections {
		if len(section.Kind) > 32 || len(section.Name) > 4096 || section.Time.IsZero() {
			return nil, errors.New("排障快照项目无效")
		}
	}
	value, err := json.Marshal(snapshot)
	if err != nil {
		return nil, err
	}
	if len(value) > 4<<20 {
		return nil, errors.New("排障快照超过 4 MiB 上限")
	}
	return value, nil
}

func (a *AppService) diagnosticSnapshotIndex() ([]DiagnosticSnapshotInfo, error) {
	if err := a.openStorage(); err != nil {
		return nil, err
	}
	value, err := a.store.SecretSetting("diagnostic_snapshots")
	if err != nil {
		return nil, err
	}
	items := []DiagnosticSnapshotInfo{}
	if len(value) > 64<<10 {
		return nil, errors.New("排障快照索引超过大小限制")
	}
	if value != "" {
		if err := decodeWorkflow(value, &items); err != nil {
			return nil, err
		}
	}
	if len(items) > 8 {
		return nil, errors.New("排障快照超过 8 项上限")
	}
	return items, nil
}

func (a *AppService) ListDiagnosticSnapshots() ([]DiagnosticSnapshotInfo, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	return a.diagnosticSnapshotIndex()
}

func (a *AppService) ReadDiagnosticSnapshot(id string) (DiagnosticSnapshot, error) {
	if !validWorkspaceID(id) {
		return DiagnosticSnapshot{}, errors.New("快照标识无效")
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return DiagnosticSnapshot{}, err
	}
	value, err := a.store.SecretSetting("diagnostic_snapshot:" + id)
	if err != nil {
		return DiagnosticSnapshot{}, err
	}
	if value == "" || len(value) > 4<<20 {
		return DiagnosticSnapshot{}, errors.New("排障快照不存在或超过大小限制")
	}
	var snapshot DiagnosticSnapshot
	if err := decodeWorkflow(value, &snapshot); err != nil {
		return snapshot, err
	}
	if _, err := validateDiagnosticSnapshot(snapshot); err != nil {
		return snapshot, err
	}
	if snapshot.Info.ID != id {
		return snapshot, errors.New("排障快照标识不匹配")
	}
	return snapshot, nil
}

func (a *AppService) SaveDiagnosticSnapshot(snapshot DiagnosticSnapshot) error {
	value, err := validateDiagnosticSnapshot(snapshot)
	if err != nil {
		return err
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	items, err := a.diagnosticSnapshotIndex()
	if err != nil {
		return err
	}
	found := false
	for i, item := range items {
		if item.ID == snapshot.Info.ID {
			items[i] = snapshot.Info
			found = true
		}
	}
	if !found {
		if len(items) >= 8 {
			return errors.New("排障快照达到 8 项上限，请先移除旧快照")
		}
		items = append(items, snapshot.Info)
	}
	index, err := json.Marshal(items)
	if err != nil {
		return err
	}
	return a.store.UpdateSecretSettings(map[string]string{"diagnostic_snapshots": string(index), "diagnostic_snapshot:" + snapshot.Info.ID: string(value)}, nil)
}

func (a *AppService) DeleteDiagnosticSnapshot(id string) error {
	if !validWorkspaceID(id) {
		return errors.New("快照标识无效")
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	items, err := a.diagnosticSnapshotIndex()
	if err != nil {
		return err
	}
	remaining := []DiagnosticSnapshotInfo{}
	for _, item := range items {
		if item.ID != id {
			remaining = append(remaining, item)
		}
	}
	index, err := json.Marshal(remaining)
	if err != nil {
		return err
	}
	return a.store.UpdateSecretSettings(map[string]string{"diagnostic_snapshots": string(index)}, []string{"diagnostic_snapshot:" + id})
}

func (a *AppService) ExportDiagnosticSnapshot(snapshot DiagnosticSnapshot, selected []int) error {
	if _, err := validateDiagnosticSnapshot(snapshot); err != nil {
		return err
	}
	if len(selected) == 0 || len(selected) > len(snapshot.Sections) {
		return errors.New("请选择导出项目")
	}
	sections := []DiagnosticSection{}
	seen := map[int]bool{}
	for _, index := range selected {
		if index < 0 || index >= len(snapshot.Sections) || seen[index] {
			return errors.New("导出项目无效或重复")
		}
		seen[index] = true
		sections = append(sections, snapshot.Sections[index])
	}
	snapshot.Sections = sections
	value, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		return err
	}
	filename, err := application.Get().Dialog.SaveFile().SetMessage("导出已预览的排障内容（可能包含日志和进程参数）").SetFilename("termquay-diagnostic-snapshot.json").PromptForSingleSelection()
	if err != nil || filename == "" {
		return err
	}
	return os.WriteFile(filename, value, 0600)
}
