package app

import (
	"context"
	"encoding/json"
	"errors"
	"path"
	"strings"
	"time"

	"github.com/Sanjeever/termquay/internal/ai"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
)

var aiTools = []ai.Tool{
	{Name: "file_list", Description: "列出当前 SSH 主机绝对路径目录，输出可能截断", Parameters: json.RawMessage(`{"type":"object","properties":{"path":{"type":"string"}},"required":["path"],"additionalProperties":false}`)},
	{Name: "file_read", Description: "读取当前 SSH 主机文本文件；encoding 可省略，默认 UTF-8", Parameters: json.RawMessage(`{"type":"object","properties":{"path":{"type":"string"},"encoding":{"type":"string"}},"required":["path"],"additionalProperties":false}`)},
	{Name: "service_list", Description: "查询 systemd 服务，可按 search 筛选", Parameters: json.RawMessage(`{"type":"object","properties":{"search":{"type":"string"}},"additionalProperties":false}`)},
	{Name: "service_inspect", Description: "查询 systemd 服务详情", Parameters: json.RawMessage(`{"type":"object","properties":{"unit":{"type":"string"}},"required":["unit"],"additionalProperties":false}`)},
	{Name: "service_logs", Description: "读取 systemd 服务近期日志，不提权", Parameters: json.RawMessage(`{"type":"object","properties":{"unit":{"type":"string"}},"required":["unit"],"additionalProperties":false}`)},
	{Name: "port_list", Description: "查询当前 SSH 主机监听端口", Parameters: json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`)},
	{Name: "container_list", Description: "查询当前 SSH 主机 Docker 容器；socket 默认 /var/run/docker.sock", Parameters: json.RawMessage(`{"type":"object","properties":{"socket":{"type":"string"}},"additionalProperties":false}`)},
	{Name: "container_inspect", Description: "查询当前 SSH 主机 Docker 容器详情", Parameters: json.RawMessage(`{"type":"object","properties":{"socket":{"type":"string"},"id":{"type":"string"}},"required":["id"],"additionalProperties":false}`)},
	{Name: "container_logs", Description: "读取当前 SSH 主机 Docker 容器近期日志", Parameters: json.RawMessage(`{"type":"object","properties":{"socket":{"type":"string"},"id":{"type":"string"}},"required":["id"],"additionalProperties":false}`)},
	{Name: "exec", Description: "通过独立无 PTY SSH session 执行 sh -s 脚本。显式 cd 设置目录；不继承终端环境，不代填 sudo 密码。命令可能需要用户批准", Parameters: json.RawMessage(`{"type":"object","properties":{"script":{"type":"string"},"timeout_seconds":{"type":"integer","minimum":1,"maximum":600}},"required":["script","timeout_seconds"],"additionalProperties":false}`)},
}

type aiToolArguments struct {
	Path           string `json:"path"`
	Encoding       string `json:"encoding"`
	Search         string `json:"search"`
	Unit           string `json:"unit"`
	Socket         string `json:"socket"`
	ID             string `json:"id"`
	Script         string `json:"script"`
	TimeoutSeconds int    `json:"timeout_seconds"`
}

type aiToolResult struct {
	Data          string `json:"data"`
	Error         string `json:"error,omitempty"`
	Truncated     bool   `json:"truncated"`
	ExitCode      *int   `json:"exit_code,omitempty"`
	StatusUnknown bool   `json:"status_unknown"`
}

func validateAITool(call ai.ToolCall) (aiToolArguments, error) {
	var args aiToolArguments
	if len(call.Arguments) > ai.MaxArgumentsBytes {
		return args, errors.New("工具参数超过限制")
	}
	var properties map[string]json.RawMessage
	if err := json.Unmarshal([]byte(call.Arguments), &properties); err != nil || properties == nil {
		return args, errors.New("工具参数必须是 JSON 对象")
	}
	found := false
	for _, tool := range aiTools {
		if tool.Name != call.Name {
			continue
		}
		found = true
		var schema struct {
			Properties map[string]any `json:"properties"`
			Required   []string       `json:"required"`
		}
		if err := json.Unmarshal(tool.Parameters, &schema); err != nil {
			return args, err
		}
		for key, value := range properties {
			if _, ok := schema.Properties[key]; !ok || string(value) == "null" {
				return args, errors.New("工具包含未知或空参数: " + key)
			}
		}
		for _, key := range schema.Required {
			if _, ok := properties[key]; !ok {
				return args, errors.New("工具缺少参数: " + key)
			}
		}
	}
	if !found {
		return args, errors.New("未知 AI 工具")
	}
	if err := json.Unmarshal([]byte(call.Arguments), &args); err != nil {
		return args, err
	}
	if call.Name == "file_list" || call.Name == "file_read" {
		if !path.IsAbs(args.Path) || len(args.Path) > 4096 || strings.ContainsRune(args.Path, 0) {
			return args, errors.New("文件工具需要远端绝对路径")
		}
	}
	if call.Name == "exec" && (len(args.Script) == 0 || len(args.Script) > 32<<10 || strings.ContainsRune(args.Script, 0) || args.TimeoutSeconds < 1 || args.TimeoutSeconds > 600) {
		return args, errors.New("Shell 脚本或超时无效")
	}
	if args.Encoding == "" {
		args.Encoding = "UTF-8"
	}
	if args.Socket == "" {
		args.Socket = "/var/run/docker.sock"
	}
	return args, nil
}

func (a *AppService) invokeAITool(ctx context.Context, run *aiRun, call ai.ToolCall, args aiToolArguments) (aiToolResult, string) {
	if err := ctx.Err(); err != nil {
		return aiToolResult{Error: "已取消，未执行"}, "not_executed"
	}
	if _, err := a.aiOwner(run.view.Workspace, run.owner); err != nil {
		return aiToolResult{Error: err.Error()}, "not_executed"
	}
	if call.Name == "exec" {
		if run.rejected[args.Script] {
			return aiToolResult{Error: "此脚本在本轮已被用户拒绝，禁止自动重试"}, "rejected"
		}
		if run.config.ConfirmExec {
			approved, err := a.awaitAIApproval(ctx, run, call, args.TimeoutSeconds)
			if err != nil {
				return aiToolResult{Error: err.Error()}, "not_executed"
			}
			if !approved {
				run.rejected[args.Script] = true
				return aiToolResult{Error: "用户拒绝，命令未执行"}, "rejected"
			}
		}
	}
	if err := ctx.Err(); err != nil {
		return aiToolResult{Error: "已取消，未执行"}, "not_executed"
	}
	if _, err := a.aiOwner(run.view.Workspace, run.owner); err != nil {
		return aiToolResult{Error: err.Error()}, "not_executed"
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	if call.Name == "exec" {
		cancel()
		ctx, cancel = context.WithTimeout(run.ctx, time.Duration(args.TimeoutSeconds)*time.Second)
	}
	defer cancel()
	var value any
	var err error
	workspace := run.view.Workspace
	switch call.Name {
	case "file_list":
		value, err = a.BrowseTransferDirectory(ctx, workspace, args.Path)
	case "file_read":
		value, err = a.ReadRemoteFileEncoded(ctx, workspace, args.Path, args.Encoding)
	case "service_list":
		value, err = a.ListLinuxServices(ctx, workspace, args.Search)
	case "service_inspect":
		value, err = a.ReadLinuxServiceDetails(ctx, workspace, args.Unit)
	case "service_logs":
		value, err = a.ReadLinuxServiceLog(ctx, workspace, args.Unit)
	case "port_list":
		value, err = a.ListLinuxPorts(ctx, workspace)
	case "container_list":
		value, err = a.ListContainers(ctx, workspace, args.Socket)
	case "container_inspect":
		value, err = a.InspectContainer(ctx, workspace, args.Socket, args.ID)
	case "container_logs":
		value, err = a.ReadContainerLogs(ctx, workspace, args.Socket, args.ID)
	case "exec":
		value, err = a.RunRemoteCommand(ctx, workspace, args.Script, args.TimeoutSeconds)
	default:
		err = errors.New("未知 AI 工具")
	}
	result := aiToolResult{}
	state := "complete"
	if command, ok := value.(terminal.CommandResult); ok {
		result.ExitCode = &command.ExitCode
		result.StatusUnknown = command.ExitCode < 0
		result.Truncated = command.Truncated
		if command.Error != "" {
			result.Error = command.Error
		}
		if command.ExitCode != 0 || command.Error != "" {
			state = "failed"
		}
		if result.StatusUnknown {
			state = "unknown"
		}
	}
	if err != nil {
		result.Error = err.Error()
		state = "failed"
	}
	b, marshalErr := json.Marshal(value)
	if marshalErr != nil {
		result.Error = marshalErr.Error()
		state = "failed"
	}
	var flags struct {
		Truncated bool `json:"truncated"`
	}
	_ = json.Unmarshal(b, &flags)
	result.Truncated = result.Truncated || flags.Truncated
	if len(b) > maxAIToolResultBytes {
		b = b[:maxAIToolResultBytes]
		result.Truncated = true
	}
	result.Data = strings.ToValidUTF8(string(b), "�")
	if result.StatusUnknown {
		result.Error += "；远端执行状态未知，不能据此认定远端进程已退出"
	}
	return result, state
}

func (a *AppService) awaitAIApproval(ctx context.Context, run *aiRun, call ai.ToolCall, timeout int) (bool, error) {
	run.mu.Lock()
	run.view.Pending = &AIPendingApproval{Token: aiID(), Call: call, TimeoutSeconds: timeout}
	run.view.State = "awaiting_approval"
	run.view.Revision++
	run.mu.Unlock()
	a.emitAIChanged(run)
	defer func() {
		run.mu.Lock()
		run.view.Pending = nil
		run.view.State = "running"
		run.view.Revision++
		run.mu.Unlock()
		a.emitAIChanged(run)
	}()
	select {
	case approved := <-run.approval:
		return approved, nil
	case <-ctx.Done():
		return false, ctx.Err()
	}
}

func (a *AppService) ApproveAIToolCall(decision AIToolDecision) error {
	return a.decideAITool(decision, true)
}
func (a *AppService) RejectAIToolCall(decision AIToolDecision) error {
	return a.decideAITool(decision, false)
}

func (a *AppService) decideAITool(d AIToolDecision, approved bool) error {
	a.aiMu.Lock()
	defer a.aiMu.Unlock()
	run := a.aiRuns[d.Workspace]
	if run == nil || run.ctx.Err() != nil {
		return errors.New("AI 批准已失效")
	}
	if _, err := a.aiOwner(d.Workspace, run.owner); err != nil {
		return err
	}
	run.mu.Lock()
	defer run.mu.Unlock()
	p := run.view.Pending
	if p == nil || run.view.ID != d.RunID || run.view.ConversationID != d.ConversationID || p.Token != d.Token || p.Call.ID != d.CallID || p.Call.Arguments != d.Arguments || p.TimeoutSeconds != d.TimeoutSeconds {
		return errors.New("AI 批准内容已变化或已消费")
	}
	run.view.Pending = nil
	run.view.Revision++
	run.approval <- approved
	return nil
}
