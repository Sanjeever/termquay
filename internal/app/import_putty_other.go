//go:build !windows

package app

import appmessage "github.com/Sanjeever/termquay/internal/message"

func readPuTTYSessions() ([]SSHImportRow, []string, error) {
	return nil, nil, appmessage.New("backend:readingWindowsPuTTYSessionsIsUnsupportedOnThis", "当前平台不支持读取 Windows PuTTY 会话")
}
