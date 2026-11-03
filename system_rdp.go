package main

import (
	"errors"
	"runtime"
	"strings"

	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"github.com/Sanjeever/termquay/internal/store"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func (a *AppService) SystemRDPAvailable() bool { return runtime.GOOS == "windows" }

func (a *AppService) OpenSavedSystemRDP(id, resolution string, clipboard bool) error {
	auth, connection, err := a.savedRequest(id)
	if err != nil {
		return err
	}
	return a.OpenSystemRDP(connection, auth, resolution, clipboard)
}

func (a *AppService) OpenSystemRDP(connection store.Connection, auth terminal.Request, resolution string, clipboard bool) error {
	if connection.Protocol != "rdp" || connection.Host == "" || connection.Port < 1 || connection.Port > 65535 {
		return errors.New("RDP 目标无效")
	}
	for _, value := range []string{connection.Host, connection.Username, connection.Domain} {
		if strings.ContainsAny(value, "\r\n\x00") {
			return errors.New("RDP 配置含无效字符")
		}
	}
	if resolution != "dynamic" && resolution != "1280x800" && resolution != "1920x1080" {
		return errors.New("远程分辨率无效")
	}
	if auth.PrivateKey != "" {
		return errors.New("RDP 无法使用 SSH 私钥")
	}
	return launchSystemRDP(connection, auth.Password, resolution, clipboard, func(err error) {
		if err != nil {
			application.Get().Event.Emit("rdp:system-error", map[string]string{"error": err.Error()})
		}
	})
}
