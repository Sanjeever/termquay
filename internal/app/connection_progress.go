package app

import (
	"context"
	"sync"
	"time"

	terminal "github.com/Sanjeever/termquay/internal/ssh"
)

type connectionProgress struct {
	mu    sync.Mutex
	steps []terminal.ConnectionStep
}

func (p *connectionProgress) record(step terminal.ConnectionStep) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.steps) > 0 && p.steps[len(p.steps)-1].State == "running" {
		p.steps[len(p.steps)-1] = step
	} else if len(p.steps) < 40 {
		p.steps = append(p.steps, step)
	}
}

func (p *connectionProgress) snapshot() []terminal.ConnectionStep {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]terminal.ConnectionStep{}, p.steps...)
}

type SSHConnectionFailure struct {
	Message string                    `json:"message"`
	Steps   []terminal.ConnectionStep `json:"steps"`
	err     error
}

func (e *SSHConnectionFailure) Error() string { return e.Message }
func (e *SSHConnectionFailure) Unwrap() error { return e.err }

func (a *AppService) GetSSHConnectionProgress(id string) []terminal.ConnectionStep {
	a.mu.Lock()
	state := a.sshChallenges[id]
	a.mu.Unlock()
	if state == nil || state.progress == nil {
		return []terminal.ConnectionStep{}
	}
	return state.progress.snapshot()
}

func (a *AppService) CheckSSHFileAccess(ctx context.Context, workspace string) error {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	_, release, err := a.fileClient(ctx, workspace)
	if err != nil {
		return err
	}
	release()
	return nil
}
