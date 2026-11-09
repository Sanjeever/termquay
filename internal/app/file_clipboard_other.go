//go:build !darwin && !windows && (!linux || android || server)

package app

import appmessage "github.com/Sanjeever/termquay/internal/message"

func localClipboardFiles() ([]string, error) {
	return nil, appmessage.New("backend:localFileClipboardIsUnsupportedInThisEnvironment", "当前运行环境不支持本地文件剪贴板")
}
