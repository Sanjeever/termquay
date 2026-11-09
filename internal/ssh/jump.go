package ssh

import (
	"context"
	"errors"
	appmessage "github.com/Sanjeever/termquay/internal/message"
	gossh "golang.org/x/crypto/ssh"
	"net"
)

func DialThrough(ctx context.Context, target, jump Request) (*Terminal, error) {
	return DialChain(ctx, []Request{jump, target})
}

func dialChainClients(ctx context.Context, chain []Request) ([]*gossh.Client, error) {
	if len(chain) < 1 || len(chain) > 5 {
		return nil, appmessage.New("backend:sSHJumpChainsSupportUpToFourHops", "SSH 跳板链最多四跳")
	}
	clients := []*gossh.Client{}
	for index, request := range chain {
		if index > 0 && request.ProxyAddress != "" {
			for _, client := range clients {
				client.Close()
			}
			return nil, appmessage.New("backend:connectionProxiesCanOnlyBeConfiguredOnThe", "连接代理只能配置在首个跳板")
		}
		connect := func(ctx context.Context, address string) (net.Conn, error) {
			if len(clients) == 0 {
				return connectDirect(ctx, request, address)
			}
			return clients[len(clients)-1].DialContext(ctx, "tcp", address)
		}
		client, err := dialClient(ctx, request, connect)
		if err != nil {
			for _, opened := range clients {
				opened.Close()
			}
			var identity *HostKeyError
			if errors.As(err, &identity) {
				identity.Jump = index < len(chain)-1
			}
			return nil, err
		}
		clients = append(clients, client)
	}
	return clients, nil
}

func DialChain(ctx context.Context, chain []Request) (*Terminal, error) {
	clients, err := dialChainClients(ctx, chain)
	if err != nil {
		return nil, err
	}
	t, err := terminalOn(ctx, clients[len(clients)-1], chain[len(chain)-1])
	if err != nil {
		for _, client := range clients {
			client.Close()
		}
		return nil, err
	}
	t.jumps = clients[:len(clients)-1]
	return t, nil
}
