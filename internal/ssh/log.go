package ssh

import (
	"errors"
	"fmt"
	"golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
	"io"
	"maze.io/x/asciicast"
	"os"
	"path/filepath"
)

type TerminalLogStatus struct {
	Directory string `json:"directory"`
	Recording bool   `json:"recording"`
	Error     string `json:"error"`
	Format    string `json:"format"`
	File      string `json:"file"`
}

type terminalLog struct {
	status TerminalLogStatus
	file   *os.File
	index  int
	size   int64
	cast   *asciicast.Encoder
	text   *transform.Writer
	events int
}

func (t *Terminal) StartLog(parent string) (TerminalLogStatus, error) {
	t.logMu.Lock()
	defer t.logMu.Unlock()
	if t.logClosed {
		return TerminalLogStatus{}, errors.New("终端已关闭")
	}
	if t.log != nil && t.log.cast != nil {
		if t.log.file != nil {
			return t.log.status, errors.New("请先暂停当前录制")
		}
		t.log = nil
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
		if t.log.text != nil {
			if err := t.log.text.Close(); err != nil {
				t.log.status.Error = err.Error()
			}
			t.log.text = nil
		}
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
	data = t.completionLog.filter(data)
	log := t.log
	if log == nil || log.file == nil {
		return
	}
	if log.cast != nil {
		if _, err := log.text.Write(data); err != nil {
			t.pauseLogLocked()
			log.status.Error = err.Error()
		}
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

type castWriter struct{ log *terminalLog }

func (w castWriter) Write(data []byte) (int, error) {
	if w.log.size+int64(len(data)) > 16<<20 {
		return 0, errors.New("录制达到 16 MiB 上限，已停止")
	}
	if w.log.events >= 100001 {
		return 0, errors.New("录制达到 100000 个事件上限，已停止")
	}
	w.log.events++
	n, err := w.log.file.Write(data)
	w.log.size += int64(n)
	if err == nil && n != len(data) {
		err = io.ErrShortWrite
	}
	return n, err
}

func (t *Terminal) StartTimedLog(parent string) (TerminalLogStatus, error) {
	t.logMu.Lock()
	defer t.logMu.Unlock()
	if t.logClosed {
		return TerminalLogStatus{}, errors.New("终端已关闭")
	}
	if t.logCols < 1 || t.logRows < 1 {
		return TerminalLogStatus{}, errors.New("终端尺寸尚未就绪")
	}
	if t.log != nil && t.log.file != nil {
		return t.log.status, errors.New("请先暂停当前记录")
	}
	if t.log != nil && t.log.cast != nil && t.log.status.Error != "" {
		t.log = nil
	}
	if t.log == nil || t.log.cast == nil {
		directory, err := os.MkdirTemp(parent, "termquay-recording-")
		if err != nil {
			return TerminalLogStatus{}, err
		}
		t.log = &terminalLog{status: TerminalLogStatus{Directory: directory, Format: "asciicast", File: filepath.Join(directory, "session.cast")}}
	}
	log := t.log
	file, err := os.OpenFile(log.status.File, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return log.status, err
	}
	log.file = file
	if log.cast == nil {
		log.cast = asciicast.NewEncoder(castWriter{log}, t.logCols, t.logRows)
		if err = log.cast.WriteHeader(); err != nil {
			t.pauseLogLocked()
			log.status.Error = err.Error()
			return log.status, err
		}
	}
	log.text = transform.NewWriter(log.cast, unicode.UTF8.NewDecoder())
	if err = log.cast.WriteEvent(asciicast.EventType("r"), fmt.Sprintf("%dx%d", t.logCols, t.logRows)); err != nil {
		t.pauseLogLocked()
		log.status.Error = err.Error()
		return log.status, err
	}
	log.status.Recording = true
	log.status.Error = ""
	return log.status, nil
}

func (t *Terminal) recordResize(cols, rows int) {
	t.logMu.Lock()
	defer t.logMu.Unlock()
	t.logCols, t.logRows = cols, rows
	if t.log == nil || t.log.cast == nil || t.log.file == nil {
		return
	}
	if err := t.log.cast.WriteEvent(asciicast.EventType("r"), fmt.Sprintf("%dx%d", cols, rows)); err != nil {
		t.pauseLogLocked()
		t.log.status.Error = err.Error()
	}
}
