package app

import (
	"context"
	"encoding/base64"
	"errors"
	"time"

	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func (a *AppService) ResizeTerminal(id string, cols, rows int) error {
	a.mu.Lock()
	p := a.terminals[id]
	a.mu.Unlock()
	if p == nil {
		return errors.New("终端已关闭")
	}
	return p.terminal.Resize(cols, rows)
}

func (a *AppService) CloseTerminal(id string) {
	a.mu.Lock()
	p := a.terminals[id]
	delete(a.terminals, id)
	a.mu.Unlock()
	if p != nil {
		p.timer.Stop()
		p.terminal.Close()
	}
}

func (a *AppService) CreateTerminal(workspace string) (OpenResult, error) {
	return a.createTerminal(workspace, "")
}

func (a *AppService) CreateTmuxTerminal(ctx context.Context, workspace, name string) (OpenResult, error) {
	if !validTmuxName(name) {
		return OpenResult{}, errors.New("tmux 会话名称无效")
	}
	sessions, err := a.ListTmuxSessions(ctx, workspace)
	if err != nil {
		return OpenResult{}, err
	}
	for _, session := range sessions {
		if session.Name == name {
			if err := ctx.Err(); err != nil {
				return OpenResult{}, err
			}
			return a.createTerminal(workspace, session.ID)
		}
	}
	return OpenResult{}, errors.New("绑定的 tmux 会话已不存在，请选择已有会话或在普通终端新建")
}

func (a *AppService) createTerminal(workspace, tmuxSession string) (OpenResult, error) {
	a.mu.Lock()
	owner := a.workspaces[workspace]
	count := 0
	for _, p := range a.terminals {
		if p.workspace == workspace {
			count++
		}
	}
	if owner == nil || a.closed || count+owner.opening >= 8 || len(a.terminals)+len(a.containerTerminals)+a.opening >= 64 {
		a.mu.Unlock()
		return OpenResult{}, errors.New("工作区已关闭或终端达到上限（每工作区 8 个，全局 64 个）")
	}
	a.opening++
	owner.opening++
	a.mu.Unlock()
	defer func() { a.mu.Lock(); a.opening--; owner.opening--; a.mu.Unlock() }()
	var t *terminal.Terminal
	var err error
	if tmuxSession == "" {
		t, err = owner.terminal.OpenPTY(100, 30)
	} else {
		t, err = owner.terminal.OpenTmuxPTY(tmuxSession)
	}
	if err != nil {
		return OpenResult{}, err
	}
	id := base64.RawURLEncoding.EncodeToString(randomBytes(24))
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.workspaces[workspace] != owner {
		t.Close()
		return OpenResult{}, errors.New("工作区已关闭")
	}
	p := &pendingTerminal{terminal: t, workspace: workspace}
	a.terminals[id] = p
	p.timer = time.AfterFunc(15*time.Second, func() {
		a.mu.Lock()
		pending := a.terminals[id]
		unattached := pending != nil && !pending.attached
		a.mu.Unlock()
		if unattached {
			a.CloseTerminal(id)
		}
	})
	return OpenResult{ID: id}, nil
}

func (a *AppService) handleWorkspace(c *application.StreamConn) {
	deadline := time.AfterFunc(5*time.Second, func() { c.Close() })
	raw, err := c.Receive()
	deadline.Stop()
	if err != nil {
		return
	}
	id := string(raw)
	a.mu.Lock()
	owner := a.workspaces[id]
	if owner == nil || owner.stream != nil {
		a.mu.Unlock()
		return
	}
	owner.stream = c
	owner.timer.Stop()
	a.mu.Unlock()
	defer a.CloseWorkspace(id)
	<-c.Context().Done()
}

func (a *AppService) handleTerminal(c *application.StreamConn) {
	deadline := time.AfterFunc(5*time.Second, func() { c.Close() })
	frame, err := c.Receive()
	deadline.Stop()
	if err != nil {
		return
	}
	id := string(frame)
	a.mu.Lock()
	p := a.terminals[id]
	if p == nil || p.attached {
		a.mu.Unlock()
		return
	}
	p.attached = true
	p.timer.Stop()
	a.mu.Unlock()
	defer a.CloseTerminal(id)
	if err = terminal.Relay(p.terminal, c, a.applicationInputAllowed); err != nil && c.Context().Err() == nil {
		application.Get().Event.Emit("terminal:error", map[string]string{"id": id, "error": err.Error()})
	}
}
