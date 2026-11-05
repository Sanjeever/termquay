package app

import (
	"context"
	"encoding/json"
	"path"
	"strings"
	"time"

	"github.com/Sanjeever/termquay/internal/localapi"
)

func (a *AppService) readCLIWorkspace(ctx context.Context, r localapi.Request) localapi.Response {
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
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	stop := context.AfterFunc(owner.ctx, cancel)
	defer stop()
	var value any
	var err error
	switch r.Operation {
	case "file.list", "file.read":
		if !path.IsAbs(r.Path) || len(r.Path) > 4096 || strings.ContainsRune(r.Path, 0) {
			return localapi.Failure("invalid_request", "请提供有效的远端绝对路径", false)
		}
		if r.Operation == "file.list" {
			value, err = a.BrowseTransferDirectory(ctx, r.Workspace, r.Path)
		} else {
			charset := r.Encoding
			if charset == "" {
				charset = "UTF-8"
			}
			value, err = a.ReadRemoteFileEncoded(ctx, r.Workspace, r.Path, charset)
		}
	case "service.list":
		value, err = a.ListLinuxServices(ctx, r.Workspace, r.Search)
	case "service.inspect":
		value, err = a.ReadLinuxServiceDetails(ctx, r.Workspace, r.Unit)
	case "service.logs":
		value, err = a.ReadLinuxServiceLog(ctx, r.Workspace, r.Unit)
	case "port.list":
		value, err = a.ListLinuxPorts(ctx, r.Workspace)
	case "container.list", "container.inspect", "container.logs":
		socket := r.Socket
		if socket == "" {
			socket = "/var/run/docker.sock"
		}
		switch r.Operation {
		case "container.list":
			value, err = a.ListContainers(ctx, r.Workspace, socket)
		case "container.inspect":
			value, err = a.InspectContainer(ctx, r.Workspace, socket, r.ID)
		case "container.logs":
			value, err = a.ReadContainerLogs(ctx, r.Workspace, socket, r.ID)
		}
	}
	if err != nil {
		return localapi.Failure("query", err.Error(), false)
	}
	return localapi.Result(value)
}

func (a *AppService) readCLITasks(r localapi.Request) localapi.Response {
	if (r.Operation == "task.show" || r.Operation == "run.show") && r.ID == "" {
		return localapi.Failure("invalid_request", "必须提供精确任务或执行记录 ID", false)
	}
	switch r.Operation {
	case "task.list", "task.show":
		tasks, err := a.ListCommandTasks()
		if err != nil {
			return localapi.Failure("storage", err.Error(), false)
		}
		if r.Operation == "task.show" {
			for _, task := range tasks {
				if task.ID == r.ID {
					return localapi.Result(task)
				}
			}
			return localapi.Failure("not_found", "保存任务不存在", false)
		}
		type taskSummary struct {
			ID        string `json:"id"`
			Name      string `json:"name"`
			StepCount int    `json:"step_count"`
		}
		items := []taskSummary{}
		for _, task := range tasks {
			if strings.Contains(strings.ToLower(task.Name), strings.ToLower(r.Search)) {
				items = append(items, taskSummary{ID: task.ID, Name: task.Name, StepCount: len(task.Steps)})
			}
		}
		return localapi.Result(items)
	case "run.list":
		runs, err := a.ListCommandRuns()
		if err != nil {
			return localapi.Failure("storage", err.Error(), false)
		}
		items := []CommandRunSummary{}
		for _, run := range runs {
			if strings.Contains(strings.ToLower(run.Name), strings.ToLower(r.Search)) {
				items = append(items, run)
			}
		}
		return localapi.Result(items)
	case "run.show":
		if r.Offset < 0 || r.Offset > 1024 || r.Limit < 0 || r.Limit > 64 {
			return localapi.Failure("invalid_request", "结果分页参数无效", false)
		}
		record, err := a.GetCommandRun(r.ID)
		if err != nil {
			return localapi.Failure("query", err.Error(), false)
		}
		if r.Revision != 0 && r.Revision != record.Summary.Revision {
			return localapi.Failure("record_changed", "执行记录已变化，请从第一页重新读取", false)
		}
		return cliRunPage(record, r.Offset, r.Limit)
	}
	return localapi.Failure("invalid_request", "未知任务查询", false)
}

func cliRunPage(record CommandRunRecord, offset, limit int) localapi.Response {
	if offset > len(record.Results) {
		return localapi.Failure("invalid_request", "结果偏移超过记录条数", false)
	}
	if limit == 0 {
		limit = 8
	}
	view := struct {
		Summary    CommandRunSummary `json:"summary"`
		Task       *CommandTask      `json:"task,omitempty"`
		Results    []CommandRunItem  `json:"results"`
		Offset     int               `json:"offset"`
		Total      int               `json:"total"`
		NextOffset int               `json:"next_offset"`
		HasMore    bool              `json:"has_more"`
	}{Summary: record.Summary, Results: []CommandRunItem{}, Offset: offset, Total: len(record.Results)}
	if offset == 0 {
		view.Task = &record.Task
	}
	header, err := json.Marshal(view)
	if err != nil {
		return localapi.Failure("internal", err.Error(), false)
	}
	used := len(header)
	for _, item := range record.Results[offset:min(len(record.Results), offset+limit)] {
		data, err := json.Marshal(item)
		if err != nil {
			return localapi.Failure("internal", err.Error(), false)
		}
		if used+len(data)+1 > localapi.MaxResponse-(32<<10) {
			if len(view.Results) == 0 {
				return localapi.Failure("response_too_large", "任务定义与单条结果超过响应限制", false)
			}
			break
		}
		used += len(data) + 1
		view.Results = append(view.Results, item)
	}
	view.NextOffset = offset + len(view.Results)
	view.HasMore = view.NextOffset < view.Total
	return localapi.Result(view)
}
