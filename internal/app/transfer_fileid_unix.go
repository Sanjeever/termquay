//go:build !windows

package app

import (
	"fmt"
	appmessage "github.com/Sanjeever/termquay/internal/message"
	"os"
	"syscall"
)

func transferFileID(info os.FileInfo, _ string) (string, error) {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return "", appmessage.Errorf("backend:couldNotReadLocalFileIdentity", "无法读取本地文件身份")
	}
	return fmt.Sprintf("%d:%d", stat.Dev, stat.Ino), nil
}
