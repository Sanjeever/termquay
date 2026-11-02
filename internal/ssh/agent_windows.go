package ssh

import (
	"context"
	"github.com/Microsoft/go-winio"
	"net"
)

func dialAgent(ctx context.Context, address string) (net.Conn, error) {
	if address == "" {
		address = `\\.\pipe\openssh-ssh-agent`
	}
	return winio.DialPipeContext(ctx, address)
}
