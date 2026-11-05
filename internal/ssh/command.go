package ssh

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"time"

	gossh "golang.org/x/crypto/ssh"
)

type CommandResult struct {
	Stdout     string `json:"stdout"`
	Stderr     string `json:"stderr"`
	ExitCode   int    `json:"exit_code"`
	DurationMS int64  `json:"duration_ms"`
	Truncated  bool   `json:"truncated"`
	Error      string `json:"error"`
}

type commandOutput struct {
	buffer    bytes.Buffer
	limit     int
	truncated bool
}

func (w *commandOutput) String() string { return w.buffer.String() }
func (w *commandOutput) Bytes() []byte  { return w.buffer.Bytes() }

func (w *commandOutput) Write(data []byte) (int, error) {
	n := len(data)
	remaining := w.limit - w.buffer.Len()
	if len(data) > remaining {
		data = data[:remaining]
		w.truncated = true
	}
	w.buffer.Write(data)
	return n, nil
}

func (t *Terminal) RunCommand(ctx context.Context, script string) CommandResult {
	started := time.Now()
	if err := ctx.Err(); err != nil {
		return CommandResult{ExitCode: -1, Error: err.Error()}
	}
	t.mu.Lock()
	if t.commandRequests == nil {
		t.commandRequests = make(chan struct{}, 4)
	}
	slots := t.commandRequests
	t.mu.Unlock()
	select {
	case slots <- struct{}{}:
	default:
		return CommandResult{ExitCode: -1, Error: "SSH 命令未完成请求达到上限"}
	}
	ready := make(chan CommandResult, 1)
	go func() {
		defer func() { <-slots }()
		ready <- t.runCommand(ctx, script)
	}()
	select {
	case result := <-ready:
		return result
	case <-ctx.Done():
		return CommandResult{ExitCode: -1, DurationMS: time.Since(started).Milliseconds(), Error: ctx.Err().Error()}
	}
}

func (t *Terminal) runCommand(ctx context.Context, script string) CommandResult {
	started := time.Now()
	result := CommandResult{ExitCode: -1}
	session, err := t.client.NewSession()
	if err != nil {
		result.Error = err.Error()
		return result
	}
	defer session.Close()
	if ctx.Err() != nil {
		result.Error = ctx.Err().Error()
		return result
	}
	stop := context.AfterFunc(ctx, func() { session.Close() })
	defer stop()
	stdout := &commandOutput{limit: 64 << 10}
	stderr := &commandOutput{limit: 16 << 10}
	session.Stdin = strings.NewReader(script)
	session.Stdout, session.Stderr = stdout, stderr
	err = session.Run("sh -s")
	result.Stdout, result.Stderr = strings.ToValidUTF8(stdout.String(), "�"), strings.ToValidUTF8(stderr.String(), "�")
	result.Truncated = stdout.truncated || stderr.truncated
	result.DurationMS = time.Since(started).Milliseconds()
	if ctx.Err() != nil {
		result.Error = ctx.Err().Error()
		return result
	}
	if err == nil {
		result.ExitCode = 0
	} else {
		var exit *gossh.ExitError
		if errors.As(err, &exit) {
			result.ExitCode = exit.ExitStatus()
		} else {
			result.Error = err.Error()
		}
	}
	return result
}
