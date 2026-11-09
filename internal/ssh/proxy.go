package ssh

import (
	"context"

	"net"
	"strconv"
	"time"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	"golang.org/x/net/proxy"
)

func connectDirect(ctx context.Context, request Request, address string) (net.Conn, error) {
	dialer := &net.Dialer{Timeout: 15 * time.Second}
	if request.ProxyAddress == "" {
		return dialer.DialContext(ctx, "tcp", address)
	}
	host, port, err := net.SplitHostPort(request.ProxyAddress)
	value, parseErr := strconv.Atoi(port)
	if err != nil || parseErr != nil || host == "" || value < 1 || value > 65535 || len(request.ProxyAddress) > 1024 {
		return nil, appmessage.New("backend:sOCKS5ProxyMustBeHostPortEncloseIPv6", "SOCKS5 代理须为主机:端口，IPv6 使用方括号")
	}
	forward, err := proxy.SOCKS5("tcp", request.ProxyAddress, nil, dialer)
	if err != nil {
		return nil, err
	}
	return forward.(proxy.ContextDialer).DialContext(ctx, "tcp", address)
}
