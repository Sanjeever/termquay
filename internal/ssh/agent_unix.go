//go:build !windows

package ssh

import (
	"context"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	"net"
	"os"
)

func dialAgent(ctx context.Context, address string) (net.Conn, error) {
	if address == "" {
		address = os.Getenv("SSH_AUTH_SOCK")
	}
	if address == "" {
		return nil, appmessage.New("backend:sSHAUTHSOCKIsNotConfiguredSSHAgent", "未配置 SSH_AUTH_SOCK，SSH Agent 不可用")
	}
	return (&net.Dialer{}).DialContext(ctx, "unix", address)
}
