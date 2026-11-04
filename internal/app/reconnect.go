package app

import (
	"context"
	"errors"

	terminal "github.com/Sanjeever/termquay/internal/ssh"
)

type SSHReconnectResult struct {
	Steps     []terminal.ConnectionStep `json:"steps"`
	Result    OpenResult                `json:"result"`
	Error     string                    `json:"error"`
	Retryable bool                      `json:"retryable"`
}

func (a *AppService) ReconnectSavedSSH(ctx context.Context, id string) SSHReconnectResult {
	r, c, err := a.savedRequest(id)
	if err != nil {
		return SSHReconnectResult{Error: err.Error()}
	}
	if c.Protocol != "ssh" || r.MFA || r.AuthMethod == "keyboard_interactive" {
		return SSHReconnectResult{Error: "此连接需要手动认证"}
	}
	result, err := a.OpenTerminal(ctx, r)
	if err == nil && result.TrustRequired {
		return SSHReconnectResult{Error: "主机身份需要手动确认", Steps: result.Steps}
	}
	if err != nil {
		var connection *terminal.ConnectionError
		return SSHReconnectResult{Error: err.Error(), Steps: result.Steps, Retryable: errors.As(err, &connection) && connection.Retryable}
	}
	return SSHReconnectResult{Result: result}
}
