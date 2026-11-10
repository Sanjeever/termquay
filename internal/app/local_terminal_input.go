package app

import (
	"os"
	"path/filepath"
	"strings"
	"unicode"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func (a *AppService) LocalTerminalHasClipboardImage(id string) (bool, error) {
	if !a.applicationInputAllowed() {
		return false, appmessage.New("backend:applicationLocked", "应用已锁定")
	}
	a.mu.Lock()
	session := a.locals[id]
	a.mu.Unlock()
	if session == nil {
		return false, appmessage.New("backend:localTerminalClosed", "本地终端已关闭")
	}
	var image bool
	err := application.InvokeSyncWithError(func() error {
		var err error
		image, err = localClipboardHasImage()
		return err
	})
	return image, err
}

func (a *AppService) prepareLocalTerminalDrop(id string, paths []string) (string, error) {
	if !a.applicationInputAllowed() {
		return "", appmessage.New("backend:applicationLocked", "应用已锁定")
	}
	a.mu.Lock()
	session := a.locals[id]
	a.mu.Unlock()
	if session == nil {
		return "", appmessage.New("backend:localTerminalClosed", "本地终端已关闭")
	}
	text, err := quoteLocalTerminalPaths(session.kind, paths)
	if err != nil {
		return "", err
	}
	for _, path := range paths {
		if !filepath.IsAbs(path) {
			return "", appmessage.New("backend:invalidLocalDropPath", "Dropped paths must be absolute and contain no control characters")
		}
		if _, err := os.Lstat(path); err != nil {
			return "", err
		}
	}
	return text, nil
}

func quoteLocalTerminalPaths(kind string, paths []string) (string, error) {
	if len(paths) == 0 || len(paths) > 64 {
		return "", appmessage.New("backend:pasteFrom1To64FilesAtA", "每次粘贴支持 1 至 64 个文件")
	}
	quoted := make([]string, 0, len(paths))
	for _, path := range paths {
		if strings.ContainsFunc(path, unicode.IsControl) {
			return "", appmessage.New("backend:invalidLocalDropPath", "Dropped paths must be absolute and contain no control characters")
		}
		switch kind {
		case "shell":
			quoted = append(quoted, "'"+strings.ReplaceAll(path, "'", "'\\''")+"'")
		case "powershell":
			quoted = append(quoted, "'"+strings.ReplaceAll(path, "'", "''")+"'")
		case "cmd":
			if strings.ContainsAny(path, `"%!`) {
				return "", appmessage.New("backend:cmdDropExpansionUnsupported", "cmd.exe cannot safely insert paths containing quotes, percent signs or exclamation marks")
			}
			quoted = append(quoted, `"`+path+`"`)
		case "wsl":
			return "", appmessage.New("backend:wslDropMappingUnsupported", "Native file drops require a native shell; WSL path mapping is not configured")
		default:
			return "", appmessage.New("backend:invalidLocalShellType", "本地 Shell 类型无效")
		}
	}
	text := strings.Join(quoted, " ") + " "
	if len(text) > (256<<10)-16 {
		return "", appmessage.New("backend:localDropInputLimit", "Dropped paths exceed the terminal input limit (256 KiB)")
	}
	return text, nil
}
