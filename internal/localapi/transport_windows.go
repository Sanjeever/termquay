package localapi

import (
	"context"

	"net"
	"time"

	"github.com/Microsoft/go-winio"
	appmessage "github.com/Sanjeever/termquay/internal/message"
	"golang.org/x/sys/windows"
)

func pipeIdentity() (string, string, error) {
	token, err := windows.OpenCurrentProcessToken()
	if err != nil {
		return "", "", err
	}
	defer token.Close()
	user, err := token.GetTokenUser()
	if err != nil {
		return "", "", err
	}
	sid := user.User.Sid.String()
	return `\\.\pipe\TermQuay-CLI-` + sid, "D:P(A;;GA;;;" + sid + ")", nil
}
func listen() (net.Listener, error) {
	path, acl, err := pipeIdentity()
	if err != nil {
		return nil, err
	}
	l, err := winio.ListenPipe(path, &winio.PipeConfig{SecurityDescriptor: acl, InputBufferSize: 4096, OutputBufferSize: 4096})
	if err != nil {
		return nil, appmessage.Errorf("backend:cLIEndpointOccupiedOrUnavailable", "CLI 端点被占用或不可用：%w", err)
	}
	return l, nil
}
func dial(ctx context.Context) (net.Conn, error) {
	path, _, err := pipeIdentity()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	return winio.DialPipeContext(ctx, path)
}
