//go:build !windows

package main

import "errors"

func readPuTTYSessions() ([]SSHImportRow, []string, error) {
	return nil, nil, errors.New("当前平台不支持读取 Windows PuTTY 会话")
}
