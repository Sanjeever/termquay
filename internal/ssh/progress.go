package ssh

import (
	"context"
	"errors"
	"net"
	"syscall"
	"time"

	gossh "golang.org/x/crypto/ssh"
)

type ConnectionStep struct {
	Hop        int    `json:"hop"`
	Host       string `json:"host"`
	Port       int    `json:"port"`
	Role       string `json:"role"`
	Stage      string `json:"stage"`
	State      string `json:"state"`
	DurationMS int64  `json:"duration_ms"`
	Code       string `json:"code,omitempty"`
	Detail     string `json:"detail,omitempty"`
}

func WithConnectionProgress(r Request, hop, total int, observe func(ConnectionStep)) Request {
	r.progress = func(stage string) func(error) {
		if observe == nil {
			return func(error) {}
		}
		step := ConnectionStep{Hop: hop, Host: r.Host, Port: r.Port, Role: "目标", Stage: stage, State: "running"}
		if hop < total {
			step.Role = "跳板"
		}
		started := time.Now()
		observe(step)
		return func(err error) {
			step.DurationMS = time.Since(started).Milliseconds()
			step.State = "completed"
			if err != nil {
				step.State, step.Code, step.Detail = "failed", connectionErrorCode(err), err.Error()
				if step.Code == "connection" && stage == "SSH 用户认证" {
					step.Code = "authentication"
				}
				if len(step.Detail) > 2048 {
					runes := []rune(step.Detail)
					step.Detail = string(runes[:min(len(runes), 512)])
				}
			}
			observe(step)
		}
	}
	return r
}

func (r Request) connectionStage(stage string) func(error) {
	if r.progress == nil {
		return func(error) {}
	}
	return r.progress(stage)
}

func connectionErrorCode(err error) string {
	var dns *net.DNSError
	var timeout net.Error
	var identity *HostKeyError
	var auth *gossh.ServerAuthError
	switch {
	case errors.Is(err, context.Canceled):
		return "cancelled"
	case errors.Is(err, context.DeadlineExceeded):
		return "timeout"
	case errors.As(err, &dns):
		return "dns"
	case errors.Is(err, syscall.ECONNREFUSED):
		return "refused"
	case errors.As(err, &timeout) && timeout.Timeout():
		return "timeout"
	case errors.As(err, &identity):
		return "identity"
	case errors.As(err, &auth):
		return "authentication"
	default:
		return "connection"
	}
}
