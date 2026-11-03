//go:build !windows

package main

import (
	"errors"
	"github.com/Sanjeever/termquay/internal/store"
)

func launchSystemRDP(store.Connection, string, string, bool, func(error)) error {
	return errors.New("系统 RDP 客户端当前支持 Windows")
}
