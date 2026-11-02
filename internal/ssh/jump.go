package ssh

import (
	"context"
	"errors"
	"net"
	"time"
)

func DialThrough(ctx context.Context, target, jump Request) (*Terminal, error) {
	gateway, err := dialClient(ctx, jump, func(ctx context.Context, address string) (net.Conn, error) {
		return (&net.Dialer{Timeout: 15 * time.Second}).DialContext(ctx, "tcp", address)
	})
	if err != nil {
		var identity *HostKeyError
		if errors.As(err, &identity) {
			identity.Jump = true
		}
		return nil, err
	}
	client, err := dialClient(ctx, target, func(ctx context.Context, address string) (net.Conn, error) {
		return gateway.DialContext(ctx, "tcp", address)
	})
	if err != nil {
		gateway.Close()
		return nil, err
	}
	t, err := terminalOn(ctx, client, target)
	if err != nil {
		gateway.Close()
		return nil, err
	}
	t.jump = gateway
	return t, nil
}
