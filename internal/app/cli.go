package app

import (
	"context"
	"sort"
	"strings"

	"github.com/Sanjeever/termquay/internal/localapi"
)

func (a *AppService) handleCLI(ctx context.Context, r localapi.Request) localapi.Response {
	locked := a.appLocked.Load()
	if locked {
		if r.Operation == "status" {
			return localapi.Result(localapi.Status{Running: true, Locked: true, Version: a.build.Version, Compatible: true})
		}
		return localapi.Failure("locked", "请在桌面解锁应用", false)
	}
	a.storeMu.Lock()
	ready := a.store != nil
	a.storeMu.Unlock()
	if !ready {
		response := localapi.Failure("storage_unavailable", "请先在桌面完成存储初始化或解锁", false)
		if r.Operation == "status" {
			response.Data = localapi.Result(localapi.Status{Running: true, Version: a.build.Version, Compatible: true}).Data
		}
		return response
	}
	enabled, err := a.GetCLIAccess()
	if err != nil {
		return localapi.Failure("storage", err.Error(), false)
	}
	if r.Operation == "status" {
		return localapi.Result(localapi.Status{Running: true, Enabled: enabled, Version: a.build.Version, Compatible: true})
	}
	if !enabled {
		return localapi.Failure("disabled", "请在设置中启用允许本机 CLI 访问", false)
	}
	if a.appLocked.Load() {
		return localapi.Failure("locked", "请在桌面解锁应用", false)
	}
	switch r.Operation {
	case "connection.list":
		catalog, err := a.GetCatalog()
		if err != nil {
			return localapi.Failure("storage", err.Error(), false)
		}
		items := []localapi.Connection{}
		for _, c := range catalog.Connections {
			if r.ProtocolFilter != "" && c.Protocol != r.ProtocolFilter || r.Group != "" && c.GroupID != r.Group || r.Search != "" && !strings.Contains(strings.ToLower(c.Name+" "+c.Host+" "+c.Username), strings.ToLower(r.Search)) {
				continue
			}
			items = append(items, localapi.Connection{ID: c.ID, GroupID: c.GroupID, Name: c.Name, Protocol: c.Protocol, Host: c.Host, Port: c.Port, Username: c.Username})
		}
		return localapi.Result(items)
	case "workspace.list":
		items := []localapi.Workspace{}
		a.mu.Lock()
		for id, owner := range a.workspaces {
			state := "connected"
			if owner.ctx.Err() != nil {
				state = "disconnected"
			}
			items = append(items, localapi.Workspace{ID: id, ConnectionID: owner.connectionID, Protocol: "ssh", Target: owner.target, State: state})
		}
		a.mu.Unlock()
		sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
		return localapi.Result(items)
	case "file.list", "file.read", "service.list", "service.inspect", "service.logs", "port.list", "container.list", "container.inspect", "container.logs":
		return a.readCLIWorkspace(ctx, r)
	case "task.list", "task.show", "run.list", "run.show":
		return a.readCLITasks(r)
	case "exec":
		if r.Workspace == "" {
			return localapi.Failure("invalid_request", "必须提供精确工作区 ID", false)
		}
		a.mu.Lock()
		owner := a.workspaces[r.Workspace]
		valid := owner != nil && !a.closed && owner.ctx.Err() == nil
		a.mu.Unlock()
		if !valid {
			return localapi.Failure("workspace_unavailable", "SSH 工作区已断开或不存在", false)
		}
		result, err := a.RunRemoteCommand(ctx, r.Workspace, r.Script, r.TimeoutSeconds)
		if err != nil {
			return localapi.Failure("execution", err.Error(), false)
		}
		response := localapi.Result(struct {
			Workspace string `json:"workspace"`
			Result    any    `json:"result"`
		}{r.Workspace, result})
		if result.Error != "" {
			response.Error = &localapi.Error{Code: "execution", Message: result.Error, RemoteStateUnknown: result.ExitCode < 0}
		} else if result.ExitCode != 0 {
			response.Error = &localapi.Error{Code: "remote_exit", Message: "远端命令返回非零退出码"}
		}
		return response
	default:
		return localapi.Failure("invalid_request", "未知 CLI 操作", false)
	}
}
