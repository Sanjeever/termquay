//go:build !windows

package app

import (
	appmessage "github.com/Sanjeever/termquay/internal/message"
	"github.com/Sanjeever/termquay/internal/store"
)

func launchSystemRDP(store.Connection, string, string, bool, func(error)) error {
	return appmessage.New("backend:theSystemRDPClientCurrentlySupportsWindows", "系统 RDP 客户端当前支持 Windows")
}
