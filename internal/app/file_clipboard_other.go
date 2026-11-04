//go:build !darwin && !windows && (!linux || android || server)

package app

import "errors"

func localClipboardFiles() ([]string, error) {
	return nil, errors.New("当前运行环境不支持本地文件剪贴板")
}
