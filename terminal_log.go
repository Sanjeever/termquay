package main

import (
	"errors"
	"os"

	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func (a *AppService) terminalInstance(id string) (*terminal.Terminal, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	entry := a.terminals[id]
	if entry == nil {
		return nil, errors.New("终端已断开")
	}
	return entry.terminal, nil
}

func (a *AppService) StartTerminalLog(id string) (terminal.TerminalLogStatus, error) {
	t, err := a.terminalInstance(id)
	if err != nil {
		return terminal.TerminalLogStatus{}, err
	}
	parent := t.LogStatus().Directory
	if parent == "" {
		parent, err = application.Get().Dialog.OpenFile().SetTitle("选择终端日志目录").CanChooseFiles(false).CanChooseDirectories(true).PromptForSingleSelection()
		if err != nil || parent == "" {
			return terminal.TerminalLogStatus{}, err
		}
	}
	select {
	case <-t.Done:
		return terminal.TerminalLogStatus{}, errors.New("终端已断开")
	default:
	}
	return t.StartLog(parent)
}

func (a *AppService) PauseTerminalLog(id string) (terminal.TerminalLogStatus, error) {
	t, err := a.terminalInstance(id)
	if err != nil {
		return terminal.TerminalLogStatus{}, err
	}
	return t.PauseLog(), nil
}

func (a *AppService) GetTerminalLogStatus(id string) (terminal.TerminalLogStatus, error) {
	t, err := a.terminalInstance(id)
	if err != nil {
		return terminal.TerminalLogStatus{}, err
	}
	return t.LogStatus(), nil
}

func (a *AppService) ExportTerminalBuffer(content string) error {
	if len(content) > 16<<20 {
		return errors.New("导出终端缓冲区超过 16 MiB")
	}
	filename, err := application.Get().Dialog.SaveFile().SetMessage("导出终端缓冲区").SetFilename("terminal.txt").PromptForSingleSelection()
	if err != nil || filename == "" {
		return err
	}
	return os.WriteFile(filename, []byte(content), 0600)
}
