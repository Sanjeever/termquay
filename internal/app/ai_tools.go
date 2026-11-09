package app

import (
	"context"
	"encoding/json"
	"errors"
	"path"
	"strings"
	"time"

	"github.com/Sanjeever/termquay/internal/ai"
	"github.com/Sanjeever/termquay/internal/files"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
)

var aiTools = []ai.Tool{
	{Name: "file_list", Description: "分页列出当前 SSH 主机绝对路径目录，search 按名称包含匹配；用 next_offset 续读，目录变化时分页可能变化。Windows 支持盘符绝对路径", Parameters: json.RawMessage(`{"type":"object","properties":{"path":{"type":"string"},"search":{"type":"string"},"offset":{"type":"integer","minimum":0},"limit":{"type":"integer","minimum":1,"maximum":64}},"required":["path"],"additionalProperties":false}`)},
	{Name: "file_read", Description: "分段读取当前 SSH 主机普通文本文件。encoding 默认 UTF-8，可选 GBK、GB18030。offset 是原文件字节位置，limit 是最多读取字节数；续读使用 next_offset 和 revision，不要自行猜测字符边界。文件属性校验不是原子快照", Parameters: json.RawMessage(`{"type":"object","properties":{"path":{"type":"string"},"encoding":{"type":"string"},"offset":{"type":"integer","minimum":0},"limit":{"type":"integer","minimum":1,"maximum":8192},"revision":{"type":"string"}},"required":["path"],"additionalProperties":false}`)},
	{Name: "service_list", Description: "查询 systemd 服务，可按 search 筛选", Parameters: json.RawMessage(`{"type":"object","properties":{"search":{"type":"string"}},"additionalProperties":false}`)},
	{Name: "service_inspect", Description: "查询 systemd 服务详情", Parameters: json.RawMessage(`{"type":"object","properties":{"unit":{"type":"string"}},"required":["unit"],"additionalProperties":false}`)},
	{Name: "service_logs", Description: "读取 systemd 服务近期日志，不提权", Parameters: json.RawMessage(`{"type":"object","properties":{"unit":{"type":"string"}},"required":["unit"],"additionalProperties":false}`)},
	{Name: "port_list", Description: "查询当前 SSH 主机监听端口", Parameters: json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`)},
	{Name: "container_list", Description: "查询当前 SSH 主机 Docker 容器；socket 默认 /var/run/docker.sock", Parameters: json.RawMessage(`{"type":"object","properties":{"socket":{"type":"string"}},"additionalProperties":false}`)},
	{Name: "container_inspect", Description: "查询当前 SSH 主机 Docker 容器详情", Parameters: json.RawMessage(`{"type":"object","properties":{"socket":{"type":"string"},"id":{"type":"string"}},"required":["id"],"additionalProperties":false}`)},
	{Name: "container_logs", Description: "读取当前 SSH 主机 Docker 容器近期日志", Parameters: json.RawMessage(`{"type":"object","properties":{"socket":{"type":"string"},"id":{"type":"string"}},"required":["id"],"additionalProperties":false}`)},
	{Name: "exec", Description: "通过独立无 PTY SSH session 执行脚本，解释器由当前连接能力决定。显式设置目录；不继承终端环境，不代填密码。output_encoding 默认 UTF-8，只有已确认原生程序输出编码时才指定 GBK 或 GB18030。命令可能需要用户批准", Parameters: json.RawMessage(`{"type":"object","properties":{"script":{"type":"string"},"timeout_seconds":{"type":"integer","minimum":1,"maximum":600},"output_encoding":{"type":"string","enum":["UTF-8","GBK","GB18030"]}},"required":["script","timeout_seconds"],"additionalProperties":false}`)},
}

type aiToolArguments struct {
	Path           string `json:"path"`
	Encoding       string `json:"encoding"`
	OutputEncoding string `json:"output_encoding"`
	Offset         int64  `json:"offset"`
	Limit          int    `json:"limit"`
	Revision       string `json:"revision"`
	Search         string `json:"search"`
	Unit           string `json:"unit"`
	Socket         string `json:"socket"`
	ID             string `json:"id"`
	Script         string `json:"script"`
	TimeoutSeconds int    `json:"timeout_seconds"`
}

type AIToolResult struct {
	Shell         string `json:"shell,omitempty"`
	Status        string `json:"status"`
	ErrorCode     string `json:"error_code,omitempty"`
	StdoutBase64  string `json:"stdout_base64,omitempty"`
	StderrBase64  string `json:"stderr_base64,omitempty"`
	Data          string `json:"data"`
	Stderr        string `json:"stderr,omitempty"`
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
		if (!path.IsAbs(args.Path) && !windowsAbsolutePath(args.Path)) || len(args.Path) > 4096 || strings.ContainsRune(args.Path, 0) {
			return args, errors.New("文件工具需要远端绝对路径")
		}
		maxLimit := 8192
		if call.Name == "file_list" {
			maxLimit = 64
		}
		if args.Offset < 0 || args.Offset > files.MaxEditSize || args.Limit < 0 || args.Limit > maxLimit || len(args.Search) > 256 || strings.ContainsAny(args.Search, "\x00\r\n") || len(args.Revision) > 256 {
			return args, errors.New("文件工具分页或筛选参数无效")
		}
		if _, exists := properties["limit"]; exists && args.Limit == 0 {
			return args, errors.New("分页大小必须大于零")
		}
	}
	if call.Name == "exec" && (len(args.Script) == 0 || len(args.Script) > 32<<10 || strings.ContainsRune(args.Script, 0) || args.TimeoutSeconds < 1 || args.TimeoutSeconds > 600) {
		return args, errors.New("Shell 脚本或超时无效")
	}
	if args.Encoding == "" {
		args.Encoding = "UTF-8"
	}
	if args.OutputEncoding == "" {
		args.OutputEncoding = "UTF-8"
	}
	if args.OutputEncoding != "UTF-8" && args.OutputEncoding != "GBK" && args.OutputEncoding != "GB18030" {
		return args, errors.New("命令输出编码无效")
	}
	if args.Socket == "" {
		args.Socket = "/var/run/docker.sock"
	}
	return args, nil
}

func (a *AppService) invokeAITool(ctx context.Context, run *aiRun, call ai.ToolCall, args aiToolArguments) (AIToolResult, string) {
	if err := ctx.Err(); err != nil {
		return AIToolResult{Status: "not_executed", ErrorCode: "canceled", Error: "已取消，未执行"}, "not_executed"
	}
	if _, err := a.aiOwner(run.view.Workspace, run.owner); err != nil {
		return AIToolResult{Status: "not_executed", ErrorCode: "workspace_unavailable", Error: err.Error()}, "not_executed"
	}
	if err := aiToolUnavailable(run.environment, call.Name); err != nil {
		return boundedAIToolResult(nil, err)
	}
	if call.Name == "exec" {
		if run.unknownScripts[args.Script] {
			return AIToolResult{Status: "not_executed", ErrorCode: "replay_blocked", Error: "此脚本上次执行状态未知或输出解码失败，本轮禁止自动重试，请先核对远端状态或已有原始输出"}, "not_executed"
		}
		if run.rejected[args.Script] {
			return AIToolResult{Status: "not_executed", ErrorCode: "rejected", Error: "此脚本在本轮已被用户拒绝，禁止自动重试"}, "rejected"
		}
		if run.config.ConfirmExec {
			approved, err := a.awaitAIApproval(ctx, run, call, args.TimeoutSeconds)
			if err != nil {
				return AIToolResult{Status: "not_executed", ErrorCode: "canceled", Error: err.Error()}, "not_executed"
			}
			if !approved {
				run.rejected[args.Script] = true
				return AIToolResult{Status: "not_executed", ErrorCode: "rejected", Error: "用户拒绝，命令未执行"}, "rejected"
			}
		}
	}
	if err := ctx.Err(); err != nil {
		return AIToolResult{Status: "not_executed", ErrorCode: "canceled", Error: "已取消，未执行"}, "not_executed"
	}
	if _, err := a.aiOwner(run.view.Workspace, run.owner); err != nil {
		return AIToolResult{Status: "not_executed", ErrorCode: "workspace_unavailable", Error: err.Error()}, "not_executed"
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
		value, err = a.listAIFileDirectory(ctx, run, args)
	case "file_read":
		value, err = a.readAIFileRange(ctx, run, args)
	case "service_list":
		if run.environment.OS == "windows" {
			value, err = a.queryWindowsAI(ctx, workspace, call.Name, args, run.environment)
		} else {
			value, err = a.ListLinuxServices(ctx, workspace, args.Search)
		}
	case "service_inspect":
		if run.environment.OS == "windows" {
			value, err = a.queryWindowsAI(ctx, workspace, call.Name, args, run.environment)
		} else {
			value, err = a.ReadLinuxServiceDetails(ctx, workspace, args.Unit)
		}
	case "service_logs":
		if run.environment.OS == "windows" {
			value, err = a.queryWindowsAI(ctx, workspace, call.Name, args, run.environment)
		} else {
			value, err = a.ReadLinuxServiceLog(ctx, workspace, args.Unit)
		}
	case "port_list":
		if run.environment.OS == "windows" {
			value, err = a.queryWindowsAI(ctx, workspace, call.Name, args, run.environment)
		} else {
			value, err = a.ListLinuxPorts(ctx, workspace)
		}
	case "container_list":
		value, err = a.ListContainers(ctx, workspace, args.Socket)
	case "container_inspect":
		value, err = a.InspectContainer(ctx, workspace, args.Socket, args.ID)
	case "container_logs":
		value, err = a.ReadContainerLogs(ctx, workspace, args.Socket, args.ID)
	case "exec":
		value, err = a.runRemoteScript(ctx, workspace, args.Script, args.TimeoutSeconds, run.environment.Shell, args.OutputEncoding)
	default:
		err = errors.New("未知 AI 工具")
	}
	result, state := boundedAIToolResult(value, err)
	if call.Name == "exec" {
		result.Shell = run.environment.Shell
	}
	if call.Name == "exec" && (result.StatusUnknown || result.ErrorCode == "output_encoding") {
		run.unknownScripts[args.Script] = true
	}
	return result, state
}

func boundedAIToolResult(value any, err error) (AIToolResult, string) {
	result := AIToolResult{Status: "ok"}
	state := "complete"
	deferResult := func() (AIToolResult, string) {
		if state != "complete" {
			result.Status = "error"
			if result.ErrorCode == "" {
				result.ErrorCode = "query_failed"
			}
		} else if result.Truncated {
			result.Status = "partial"
		}
		return result, state
	}
	if command, ok := value.(terminal.CommandResult); ok {
		result.ExitCode = &command.ExitCode
		result.StatusUnknown = command.ExitCode < 0
		result.Truncated = command.Truncated
		result.StdoutBase64 = command.StdoutBase64
		result.StderrBase64 = command.StderrBase64
		if command.StdoutBase64 != "" || command.StderrBase64 != "" {
			result.ErrorCode = "output_encoding"
		}
		if command.Error != "" {
			result.Error = command.Error
		}
		if command.ExitCode != 0 || command.Error != "" {
			state = "failed"
			if result.ErrorCode == "" {
				result.ErrorCode = "command_failed"
			}
		}
		if result.StatusUnknown {
			state = "unknown"
			result.ErrorCode = "execution_unknown"
		}
		stderrBytes := min(len(command.Stderr), maxAIToolResultBytes/2)
		stderrRawBytes := min(len(command.StderrBase64), (maxAIToolResultBytes/2-stderrBytes)/4*4)
		stdoutBytes := min(len(command.Stdout), maxAIToolResultBytes-stderrBytes-stderrRawBytes)
		stdoutRawBytes := min(len(command.StdoutBase64), (maxAIToolResultBytes-stderrBytes-stderrRawBytes-stdoutBytes)/4*4)
		result.Data = strings.ToValidUTF8(command.Stdout[:stdoutBytes], "")
		result.Stderr = strings.ToValidUTF8(command.Stderr[:stderrBytes], "")
		result.Truncated = result.Truncated || stdoutBytes < len(command.Stdout) || stderrBytes < len(command.Stderr)
		result.StdoutBase64 = command.StdoutBase64[:stdoutRawBytes]
		result.StderrBase64 = command.StderrBase64[:stderrRawBytes]
		result.Truncated = result.Truncated || stdoutRawBytes < len(command.StdoutBase64) || stderrRawBytes < len(command.StderrBase64)
		if err != nil {
			result.Error = err.Error()
			state = "failed"
			if command.ExitCode == 0 {
				result.ExitCode = nil
				result.StatusUnknown = false
			}
		}
		if result.StatusUnknown {
			result.Error += "；远端执行状态未知，不能据此认定远端进程已退出"
		}
		return deferResult()
	}
	if err != nil {
		result.Error = err.Error()
		state = "failed"
		var toolErr *aiToolError
		if errors.As(err, &toolErr) {
			result.ErrorCode = toolErr.Code
		}
		var fileErr *files.ReadError
		if errors.As(err, &fileErr) {
			result.ErrorCode = fileErr.Code
		}
	}
	b, marshalErr := json.Marshal(value)
	if marshalErr != nil {
		b = []byte("null")
		result.Error = marshalErr.Error()
		result.ErrorCode = "result_encoding"
		state = "failed"
	}
	var flags struct {
		Truncated bool `json:"truncated"`
	}
	_ = json.Unmarshal(b, &flags)
	result.Truncated = result.Truncated || flags.Truncated
	if len(b) > maxAIToolResultBytes {
		b = []byte("null")
		result.Truncated = true
		result.Error = "结构化结果超过 AI 输出预算，请缩小查询范围"
		result.ErrorCode = "result_too_large"
		state = "failed"
	}
	result.Data = strings.ToValidUTF8(string(b), "�")
	return deferResult()
}

func (a *AppService) awaitAIApproval(ctx context.Context, run *aiRun, call ai.ToolCall, timeout int) (bool, error) {
	run.mu.Lock()
	run.pauseBudgetLocked()
	if ctx.Err() != nil {
		run.mu.Unlock()
		return false, context.Cause(ctx)
	}
	run.view.Pending = &AIPendingApproval{Token: aiID(), Call: call, TimeoutSeconds: timeout, Shell: run.environment.Shell}
	run.view.State = "awaiting_approval"
	run.view.Revision++
	run.mu.Unlock()
	a.emitAIChanged(run)
	defer func() {
		run.mu.Lock()
		run.view.Pending = nil
		run.view.State = "running"
		run.resumeBudgetLocked()
		run.view.Revision++
		run.mu.Unlock()
		a.emitAIChanged(run)
	}()
	select {
	case approved := <-run.approval:
		return approved, nil
	case <-ctx.Done():
		return false, context.Cause(ctx)
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
