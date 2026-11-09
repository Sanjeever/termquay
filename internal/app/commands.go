package app

import (
	"context"
	"errors"
	"strings"
	"time"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
)

func (a *AppService) RunRemoteCommand(ctx context.Context, workspace, script string, timeoutSeconds int) (terminal.CommandResult, error) {
	return a.runRemoteScript(ctx, workspace, script, timeoutSeconds, "sh", "UTF-8")
}

func (a *AppService) runRemoteScript(ctx context.Context, workspace, script string, timeoutSeconds int, shell, encoding string) (terminal.CommandResult, error) {
	if len(script) == 0 || len(script) > 32<<10 || strings.ContainsRune(script, 0) || timeoutSeconds < 1 || timeoutSeconds > 600 {
		return terminal.CommandResult{}, appmessage.New("backend:commandMustBeFrom1To32768Bytes", "命令须为 1 至 32768 字节，超时须为 1 至 600 秒")
	}
	a.mu.Lock()
	owner := a.workspaces[workspace]
	if owner == nil || a.closed {
		a.mu.Unlock()
		return terminal.CommandResult{}, appmessage.New("backend:sSHWorkspaceDisconnected", "SSH 工作区已断开")
	}
	if a.commandSlots == nil {
		a.commandSlots = make(chan struct{}, 4)
	}
	slots := a.commandSlots
	a.mu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, time.Duration(timeoutSeconds)*time.Second)
	defer cancel()
	stop := context.AfterFunc(owner.ctx, cancel)
	defer stop()
	select {
	case slots <- struct{}{}:
	case <-ctx.Done():
		return terminal.CommandResult{}, ctx.Err()
	}
	defer func() { <-slots }()
	return owner.terminal.RunScript(ctx, script, shell, encoding), nil
}

type TmuxSession struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Attached bool   `json:"attached"`
}

func (a *AppService) ListTmuxSessions(ctx context.Context, workspace string) ([]TmuxSession, error) {
	result, err := a.RunRemoteCommand(ctx, workspace, "tmux list-sessions -F '#{session_id}\t#{session_attached}\t#{session_name}'", 10)
	if err != nil {
		return nil, err
	}
	if result.Error != "" {
		return nil, errors.New(result.Error)
	}
	if result.ExitCode != 0 {
		return nil, errors.New("读取 tmux 会话失败：" + strings.TrimSpace(result.Stderr))
	}
	if result.Truncated {
		return nil, appmessage.New("backend:tmuxSessionListExceedsTheLimit", "tmux 会话列表超过限制")
	}
	sessions := []TmuxSession{}
	for _, line := range strings.Split(strings.TrimSuffix(result.Stdout, "\n"), "\n") {
		parts := strings.SplitN(line, "\t", 3)
		if len(parts) != 3 || len(parts[0]) < 2 || parts[0][0] != '$' || strings.Trim(parts[0][1:], "0123456789") != "" {
			return nil, appmessage.New("backend:invalidTmuxSessionListFormat", "tmux 会话列表格式无效")
		}
		sessions = append(sessions, TmuxSession{ID: parts[0], Name: parts[2], Attached: parts[1] != "0"})
		if len(sessions) > 128 {
			return nil, appmessage.New("backend:tmuxSessionCountExceeds128", "tmux 会话超过 128 项")
		}
	}
	return sessions, nil
}
