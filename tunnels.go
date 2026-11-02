package main

import (
	"context"
	"encoding/base64"
	"errors"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"time"
)

type Tunnel struct {
	ID        string               `json:"id"`
	Workspace string               `json:"workspace"`
	Spec      terminal.ForwardSpec `json:"spec"`
	Info      terminal.ForwardInfo `json:"info"`
}
type workspaceTunnel struct {
	view    Tunnel
	forward *terminal.Forward
	cancel  context.CancelFunc
}

func (a *AppService) StartTunnel(ctx context.Context, workspace string, spec terminal.ForwardSpec) (Tunnel, error) {
	if err := spec.Validate(); err != nil {
		return Tunnel{}, err
	}
	a.mu.Lock()
	owner := a.workspaces[workspace]
	count := 0
	for _, t := range a.tunnels {
		if t.view.Workspace == workspace {
			count++
		}
	}
	if owner == nil || a.closed || count >= 4 || len(a.tunnels) >= 32 {
		a.mu.Unlock()
		return Tunnel{}, errors.New("工作区已关闭或转发达到上限（每工作区 4 个，全局 32 个）")
	}
	start, cancel := context.WithTimeout(ctx, 20*time.Second)
	id := base64.RawURLEncoding.EncodeToString(randomBytes(16))
	entry := &workspaceTunnel{view: Tunnel{ID: id, Workspace: workspace, Spec: spec, Info: terminal.ForwardInfo{State: "starting"}}, cancel: cancel}
	a.tunnels[id] = entry
	a.mu.Unlock()
	stop := context.AfterFunc(owner.ctx, cancel)
	defer stop()
	defer cancel()
	forward, err := owner.terminal.OpenForward(start, owner.ctx, spec)
	a.mu.Lock()
	if err != nil || a.workspaces[workspace] != owner || a.tunnels[id] != entry || start.Err() != nil {
		delete(a.tunnels, id)
		a.mu.Unlock()
		if forward != nil {
			forward.Close()
		}
		if err == nil {
			err = errors.New("转发启动已取消")
		}
		return Tunnel{}, err
	}
	entry.forward = forward
	entry.view.Info = forward.Info()
	view := entry.view
	a.mu.Unlock()
	return view, nil
}
func (a *AppService) ListTunnels(workspace string) []Tunnel {
	a.mu.Lock()
	defer a.mu.Unlock()
	result := []Tunnel{}
	for _, t := range a.tunnels {
		if t.view.Workspace == workspace {
			view := t.view
			if t.forward != nil {
				view.Info = t.forward.Info()
			}
			result = append(result, view)
		}
	}
	return result
}
func (a *AppService) CloseTunnel(id string) {
	a.mu.Lock()
	entry := a.tunnels[id]
	if entry != nil {
		entry.cancel()
		if entry.forward == nil {
			delete(a.tunnels, id)
		}
	}
	a.mu.Unlock()
	if entry != nil && entry.forward != nil {
		entry.forward.Close()
		if entry.forward.Info().State == "closed" {
			a.mu.Lock()
			if a.tunnels[id] == entry {
				delete(a.tunnels, id)
			}
			a.mu.Unlock()
		}
	}
}
