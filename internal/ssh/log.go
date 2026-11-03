package ssh

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

type TerminalLogStatus struct {
	Directory string `json:"directory"`
	Recording bool   `json:"recording"`
	Error     string `json:"error"`
}

type terminalLog struct {
	status TerminalLogStatus
	file   *os.File
	index  int
	size   int64
}

func (t *Terminal) StartLog(parent string) (TerminalLogStatus, error) {
	t.logMu.Lock()
	defer t.logMu.Unlock()
	if t.logClosed {
		return TerminalLogStatus{}, errors.New("终端已关闭")
	}
	if t.log == nil {
		directory, err := os.MkdirTemp(parent, "termquay-session-")
		if err != nil {
			return TerminalLogStatus{}, err
		}
		t.log = &terminalLog{status: TerminalLogStatus{Directory: directory}}
	}
	if t.log.file != nil {
		return t.log.status, nil
	}
	file, err := os.OpenFile(filepath.Join(t.log.status.Directory, fmt.Sprintf("%02d.ansi", t.log.index)), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return t.log.status, err
	}
	t.log.file = file
	t.log.status.Recording, t.log.status.Error = true, ""
	return t.log.status, nil
}

func (t *Terminal) PauseLog() TerminalLogStatus {
	t.logMu.Lock()
	defer t.logMu.Unlock()
	return t.pauseLogLocked()
}

func (t *Terminal) closeLog() {
	t.logMu.Lock()
	defer t.logMu.Unlock()
	t.logClosed = true
	t.pauseLogLocked()
}

func (t *Terminal) pauseLogLocked() TerminalLogStatus {
	if t.log == nil {
		return TerminalLogStatus{}
	}
	if t.log.file != nil {
		if err := t.log.file.Close(); err != nil {
			t.log.status.Error = err.Error()
		}
		t.log.file = nil
	}
	t.log.status.Recording = false
	return t.log.status
}

func (t *Terminal) LogStatus() TerminalLogStatus {
	t.logMu.Lock()
	defer t.logMu.Unlock()
	if t.log == nil {
		return TerminalLogStatus{}
	}
	return t.log.status
}

func (t *Terminal) recordOutput(data []byte) {
	t.logMu.Lock()
	defer t.logMu.Unlock()
	log := t.log
	if log == nil || log.file == nil {
		return
	}
	fail := func(err error) {
		log.file.Close()
		log.file = nil
		log.status.Recording = false
		log.status.Error = err.Error()
	}
	if log.size+int64(len(data)) > 8<<20 {
		if err := log.file.Close(); err != nil {
			fail(err)
			return
		}
		log.index = (log.index + 1) % 3
		file, err := os.OpenFile(filepath.Join(log.status.Directory, fmt.Sprintf("%02d.ansi", log.index)), os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
		if err != nil {
			fail(err)
			return
		}
		log.file, log.size = file, 0
	}
	n, err := log.file.Write(data)
	log.size += int64(n)
	if err != nil {
		fail(err)
	}
}
