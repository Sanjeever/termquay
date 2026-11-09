package app

import (
	"os"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func (a *AppService) terminalInstance(id string) (*terminal.Terminal, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	entry := a.terminals[id]
	if entry == nil {
		return nil, appmessage.New("backend:terminalDisconnected", "终端已断开")
	}
	return entry.terminal, nil
}

func (a *AppService) StartTerminalLog(id string) (terminal.TerminalLogStatus, error) {
	t, err := a.terminalInstance(id)
	if err != nil {
		return terminal.TerminalLogStatus{}, err
	}
	status := t.LogStatus()
	parent := status.Directory
	if parent == "" || status.Format == "asciicast" || status.Finished {
		parent, err = application.Get().Dialog.OpenFile().SetTitle(nativeText("Select terminal log directory", "选择终端日志目录")).CanChooseFiles(false).CanChooseDirectories(true).PromptForSingleSelection()
		if err != nil || parent == "" {
			return terminal.TerminalLogStatus{}, err
		}
	}
	select {
	case <-t.Done:
		return terminal.TerminalLogStatus{}, appmessage.New("backend:terminalDisconnected", "终端已断开")
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

func (a *AppService) FinishTerminalLog(id string) (terminal.TerminalLogStatus, error) {
	t, err := a.terminalInstance(id)
	if err != nil {
		return terminal.TerminalLogStatus{}, err
	}
	return t.FinishLog(), nil
}

func (a *AppService) OpenTerminalLogDirectory(id string) error {
	t, err := a.terminalInstance(id)
	if err != nil {
		return err
	}
	status := t.LogStatus()
	if status.Directory == "" {
		return appmessage.New("backend:noRecordingOrLogSavedForThisTerminal", "本次终端尚未保存录制或日志")
	}
	return application.Get().Env.OpenFileManager(status.Directory, false)
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
		return appmessage.New("backend:terminalBufferExportExceeds16MiB", "导出终端缓冲区超过 16 MiB")
	}
	filename, err := application.Get().Dialog.SaveFile().SetMessage(nativeText("Export terminal buffer", "导出终端缓冲区")).SetFilename("terminal.txt").PromptForSingleSelection()
	if err != nil || filename == "" {
		return err
	}
	return os.WriteFile(filename, []byte(content), 0600)
}
