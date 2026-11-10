package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	"github.com/wailsapp/wails/v3/pkg/application"
)

const maxLocalTerminalDirectories = 10

func localTerminalDirectory(directory string) (string, error) {
	if directory == "" {
		var err error
		directory, err = os.UserHomeDir()
		if err != nil {
			return "", err
		}
	}
	if !filepath.IsAbs(directory) || len(directory) > 4096 || strings.ContainsAny(directory, "\x00\r\n") {
		return "", appmessage.New("backend:invalidLocalTerminalDirectory", "本地终端目录须为有效的绝对路径")
	}
	info, err := os.Stat(directory)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", appmessage.New("backend:localTerminalPathIsNotDirectory", "本地终端路径不是目录")
	}
	return filepath.Clean(directory), nil
}

func (a *AppService) ChooseLocalTerminalDirectory() (string, error) {
	return application.Get().Dialog.OpenFile().
		SetTitle(nativeText("Open terminal in directory", "在目录中打开终端")).
		CanChooseFiles(false).CanChooseDirectories(true).PromptForSingleSelection()
}

func (a *AppService) localTerminalDirectories() ([]string, error) {
	if err := a.openStorage(); err != nil {
		return nil, err
	}
	value, err := a.store.Setting("local_terminal_directories")
	if err != nil {
		return nil, err
	}
	result := []string{}
	if value != "" {
		if err := json.Unmarshal([]byte(value), &result); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func (a *AppService) GetLocalTerminalDirectories() ([]string, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	return a.localTerminalDirectories()
}

func (a *AppService) rememberLocalTerminalDirectory(directory string) error {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	directories, err := a.localTerminalDirectories()
	if err != nil {
		return err
	}
	directories = slices.DeleteFunc(directories, func(value string) bool { return value == directory })
	directories = append([]string{directory}, directories...)
	directories = directories[:min(len(directories), maxLocalTerminalDirectories)]
	data, err := json.Marshal(directories)
	if err != nil {
		return err
	}
	return a.store.SetSetting("local_terminal_directories", string(data))
}
