package app

import (
	"context"
	"crypto/sha256"
	"encoding/base64"

	"net"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	"github.com/Sanjeever/termquay/internal/rdp"
)

func rdpGatewayScope(owner *workspaceOwner) string {
	sum := sha256.Sum256([]byte(owner.target + "\x00" + owner.identity))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}
func rdpTrustAddress(target rdp.Target) string {
	if target.Scope != "" {
		return "rdp:via:" + target.Scope + ":" + target.Address()
	}
	return "rdp:" + target.Address()
}

func rdpViaOwner(target rdp.Target, owner *workspaceOwner) rdp.Target {
	target.Scope = rdpGatewayScope(owner)
	return rdp.WithDialer(target, func(ctx context.Context, address string) (net.Conn, error) {
		if err := owner.ctx.Err(); err != nil {
			return nil, appmessage.New("backend:sSHJumpWorkspaceDisconnected", "SSH 跳板工作区已断开")
		}
		return owner.terminal.DialAddress(ctx, address)
	})
}

func (a *AppService) rdpRouteTarget(host string, port int, gateway string) (rdp.Target, error) {
	target := rdp.Target{Host: host, Port: port}
	if gateway == "" {
		return target, nil
	}
	a.mu.Lock()
	owner := a.workspaces[gateway]
	closed := a.closed
	a.mu.Unlock()
	if owner == nil || closed {
		return target, appmessage.New("backend:connectTheSelectedSSHJumpWorkspaceFirst", "请先连接所选 SSH 跳板工作区")
	}
	return rdpViaOwner(target, owner), nil
}

func (a *AppService) rdpScopedTarget(host string, port int, scope string) (rdp.Target, error) {
	target := rdp.Target{Host: host, Port: port}
	if scope == "" {
		return target, nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, owner := range a.workspaces {
		if rdpGatewayScope(owner) == scope {
			return rdpViaOwner(target, owner), nil
		}
	}
	return target, appmessage.New("backend:connectTheCorrespondingSSHJumpHostBeforeReviewing", "请先连接对应 SSH 跳板，再审核远程桌面证书")
}
