package app

import (
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"unicode"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func localTerminalFileURL(path, directory string, line, column int, editor string) (string, error) {
	if len(path) == 0 || len(path) > 4096 || strings.ContainsFunc(path, unicode.IsControl) || line < 1 || line > 1_000_000_000 || column < 1 || column > 1_000_000_000 {
		return "", appmessage.New("backend:invalidLocalFileLink", "Invalid local file link")
	}
	if editor != "vscode" && editor != "vscode-insiders" {
		return "", appmessage.New("backend:unsupportedLocalEditor", "Unsupported local editor")
	}
	if !filepath.IsAbs(path) {
		if !filepath.IsAbs(directory) || len(directory) > 4096 || strings.ContainsFunc(directory, unicode.IsControl) {
			return "", appmessage.New("backend:localFileDirectoryUnknown", "The file link's original directory is unknown. Choose its base directory.")
		}
		path = filepath.Join(directory, path)
	}
	path = filepath.Clean(path)
	info, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", appmessage.New("backend:localFileLinkNotRegular", "The file link must refer to a regular file")
	}
	uriPath := filepath.ToSlash(path)
	if !strings.HasPrefix(uriPath, "/") {
		uriPath = "/" + uriPath
	}
	uri := url.URL{Scheme: editor, Host: "file", Path: uriPath + ":" + strconv.Itoa(line) + ":" + strconv.Itoa(column)}
	return uri.String(), nil
}

func (a *AppService) prepareLocalTerminalFile(id, path, directory string, line, column int, editor string) (string, error) {
	if !a.applicationInputAllowed() {
		return "", appmessage.New("backend:applicationLocked", "应用已锁定")
	}
	a.mu.Lock()
	session := a.locals[id]
	a.mu.Unlock()
	if session == nil {
		return "", appmessage.New("backend:localTerminalClosed", "本地终端已关闭")
	}
	if session.kind == "wsl" {
		return "", appmessage.New("backend:localFileMappingUnsupported", "This terminal's filesystem is not mapped to local editor paths")
	}
	return localTerminalFileURL(path, directory, line, column, editor)
}

func (a *AppService) OpenLocalTerminalFile(id, path, directory string, line, column int, editor string) error {
	uri, err := a.prepareLocalTerminalFile(id, path, directory, line, column, editor)
	if err != nil {
		return err
	}
	return application.Get().Browser.OpenURL(uri)
}
