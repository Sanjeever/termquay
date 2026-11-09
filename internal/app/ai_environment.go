package app

import (
	"context"
	"fmt"
	"strings"

	"github.com/Sanjeever/termquay/internal/ai"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
)

type aiToolError struct{ Code, Message string }

func (e *aiToolError) Error() string { return e.Message }

func aiToolUnavailable(environment terminal.RemoteEnvironment, name string) error {
	available := false
	switch name {
	case "file_list", "file_read":
		available = true
	case "exec":
		available = environment.Shell != ""
	case "service_list", "service_inspect":
		available = environment.Services
	case "service_logs":
		available = environment.Events
	case "port_list":
		available = environment.TCP || environment.UDP
	case "container_list", "container_inspect", "container_logs":
		if !environment.UnixSocket {
			return &aiToolError{Code: "unsupported_transport", Message: "当前 SSH 平台不支持既有 Docker Unix socket 查询通道；不能据此判断是否安装 Docker"}
		}
		available = true
	}
	if !available {
		return &aiToolError{Code: "capability_unavailable", Message: fmt.Sprintf("远端 %s 未确认支持工具 %s；不能将查询不可用解释为空结果", environment.OS, name)}
	}
	return nil
}

func aiToolsForEnvironment(environment terminal.RemoteEnvironment) []ai.Tool {
	tools := make([]ai.Tool, 0, len(aiTools))
	for _, tool := range aiTools {
		if aiToolUnavailable(environment, tool.Name) != nil {
			continue
		}
		if tool.Name == "exec" {
			tool.Description += "。本连接解释器为 " + environment.Shell
		}
		if environment.OS == "windows" {
			switch tool.Name {
			case "service_list":
				tool.Description = "查询 Windows 服务，可按 search 筛选名称"
			case "service_inspect":
				tool.Description = "查询 Windows 服务详情，unit 使用服务内部名称"
			case "service_logs":
				tool.Description = "读取 System 日志中与指定服务相关的 Service Control Manager 事件；不是完整应用日志"
			}
		}
		tools = append(tools, tool)
	}
	return tools
}

func (a *AppService) aiEnvironment(ctx context.Context, run *aiRun) terminal.RemoteEnvironment {
	a.mu.Lock()
	if a.commandSlots == nil {
		a.commandSlots = make(chan struct{}, 4)
	}
	slots := a.commandSlots
	a.mu.Unlock()
	select {
	case slots <- struct{}{}:
		defer func() { <-slots }()
	case <-ctx.Done():
		return terminal.RemoteEnvironment{OS: "unknown", Warning: ctx.Err().Error()}
	}
	return run.owner.terminal.Environment(ctx)
}

func aiEnvironmentPrompt(environment terminal.RemoteEnvironment) string {
	return fmt.Sprintf("\n当前连接探测结果：系统=%s，脚本解释器=%s，版本=%s。%s\n仅使用本轮提供的工具。缺少能力或查询失败不能解释为没有服务、端口或容器。不得通过相同缺失通道重复排查。Windows 脚本使用 Windows PowerShell 5.1 兼容语法，路径按 Windows 处理；其他系统使用已探测的解释器。独立 session 无 PTY，不继承终端 cwd、环境或别名。", environment.OS, environment.Shell, environment.Version, strings.TrimSpace(environment.Warning))
}
