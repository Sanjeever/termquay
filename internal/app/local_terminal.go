package app

import (
	"encoding/base64"
	"errors"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
	pty "github.com/aymanbagabas/go-pty"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type LocalShell struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type LocalTerminal struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type localTerminal struct {
	pty         pty.Pty
	command     *pty.Cmd
	done        chan struct{}
	mu          sync.Mutex
	err         error
	once        sync.Once
	consoleOnce sync.Once
	attached    bool
	timer       *time.Timer
}

func localShellCommand(kind string) (string, []string, error) {
	if runtime.GOOS == "windows" {
		switch kind {
		case "powershell":
			path, err := exec.LookPath("pwsh.exe")
			if errors.Is(err, exec.ErrNotFound) {
				path, err = exec.LookPath("powershell.exe")
			}
			return path, []string{"-NoLogo"}, err
		case "cmd":
			path, err := exec.LookPath("cmd.exe")
			return path, []string{"/D"}, err
		case "wsl":
			path, err := exec.LookPath("wsl.exe")
			return path, []string{"--cd", "~"}, err
		default:
			return "", nil, appmessage.New("backend:invalidLocalShellType", "本地 Shell 类型无效")
		}
	}
	if kind != "shell" {
		return "", nil, appmessage.New("backend:thisShellIsUnsupportedOnTheCurrentSystem", "当前系统不支持此 Shell")
	}
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/sh"
	}
	path, err := exec.LookPath(shell)
	return path, []string{"-l"}, err
}

func (a *AppService) ListLocalShells() []LocalShell {
	choices := []LocalShell{{ID: "shell", Name: "本地 Shell"}}
	if runtime.GOOS == "windows" {
		choices = []LocalShell{{ID: "powershell", Name: "PowerShell"}, {ID: "cmd", Name: "命令提示符"}, {ID: "wsl", Name: "WSL"}}
	}
	result := []LocalShell{}
	for _, choice := range choices {
		if _, _, err := localShellCommand(choice.ID); err == nil {
			result = append(result, choice)
		}
	}
	return result
}

func (a *AppService) OpenLocalTerminal(kind string, cols, rows int) (LocalTerminal, error) {
	if cols < 1 || cols > 1000 || rows < 1 || rows > 1000 {
		return LocalTerminal{}, appmessage.New("backend:invalidTerminalDimensions", "终端尺寸无效")
	}
	path, args, err := localShellCommand(kind)
	if err != nil {
		return LocalTerminal{}, err
	}
	a.mu.Lock()
	if a.closed || len(a.locals)+a.localOpening >= 16 {
		a.mu.Unlock()
		return LocalTerminal{}, appmessage.New("backend:localTerminalLimitReached16", "本地终端达到 16 个上限")
	}
	a.localOpening++
	a.mu.Unlock()
	defer func() { a.mu.Lock(); a.localOpening--; a.mu.Unlock() }()
	console, err := pty.New()
	if err != nil {
		return LocalTerminal{}, err
	}
	if err = console.Resize(cols, rows); err != nil {
		console.Close()
		return LocalTerminal{}, err
	}
	command := console.Command(path, args...)
	for _, entry := range os.Environ() {
		if !strings.HasPrefix(entry, "TERM=") && !strings.HasPrefix(entry, "COLORTERM=") {
			command.Env = append(command.Env, entry)
		}
	}
	command.Env = append(command.Env, "TERM=xterm-256color", "COLORTERM=truecolor")
	command.Dir, err = os.UserHomeDir()
	if err != nil {
		console.Close()
		return LocalTerminal{}, err
	}
	if err = command.Start(); err != nil {
		console.Close()
		return LocalTerminal{}, err
	}
	session := &localTerminal{pty: console, command: command, done: make(chan struct{})}
	id := base64.RawURLEncoding.EncodeToString(randomBytes(24))
	a.mu.Lock()
	if a.closed {
		a.mu.Unlock()
		command.Process.Kill()
		command.Wait()
		session.closeConsole(true)
		return LocalTerminal{}, appmessage.New("backend:applicationIsClosing", "应用正在关闭")
	}
	if a.locals == nil {
		a.locals = map[string]*localTerminal{}
	}
	a.locals[id] = session
	session.timer = time.AfterFunc(15*time.Second, func() {
		a.mu.Lock()
		unattached := a.locals[id] == session && !session.attached
		a.mu.Unlock()
		if unattached {
			a.CloseLocalTerminal(id)
		}
	})
	a.mu.Unlock()
	go func() {
		err := command.Wait()
		session.mu.Lock()
		session.err = err
		session.mu.Unlock()
		close(session.done)
		session.closeConsole(false)
	}()
	name := kind
	for _, choice := range a.ListLocalShells() {
		if choice.ID == kind {
			name = choice.Name
			break
		}
	}
	return LocalTerminal{ID: id, Name: name}, nil
}

func (session *localTerminal) closeConsole(discard bool) {
	if discard {
		if console, ok := session.pty.(pty.ConPty); ok {
			console.InputPipe().Close()
			console.OutputPipe().Close()
		}
	}
	session.consoleOnce.Do(func() { session.pty.Close() })
}
func (session *localTerminal) close() {
	session.once.Do(func() {
		session.timer.Stop()
		select {
		case <-session.done:
		default:
			session.command.Process.Kill()
		}
		session.closeConsole(true)
	})
}
func (session *localTerminal) waitError() error {
	session.mu.Lock()
	defer session.mu.Unlock()
	return session.err
}

func (a *AppService) CloseLocalTerminal(id string) {
	a.mu.Lock()
	session := a.locals[id]
	delete(a.locals, id)
	a.mu.Unlock()
	if session != nil {
		session.close()
	}
}
func (a *AppService) ResizeLocalTerminal(id string, cols, rows int) error {
	if cols < 1 || cols > 1000 || rows < 1 || rows > 1000 {
		return appmessage.New("backend:invalidTerminalDimensions", "终端尺寸无效")
	}
	a.mu.Lock()
	session := a.locals[id]
	a.mu.Unlock()
	if session == nil {
		return appmessage.New("backend:localTerminalClosed", "本地终端已关闭")
	}
	return session.pty.Resize(cols, rows)
}

func (a *AppService) handleLocalTerminal(stream *application.StreamConn) {
	deadline := time.AfterFunc(5*time.Second, func() { stream.Close() })
	raw, err := stream.Receive()
	deadline.Stop()
	if err != nil {
		return
	}
	id := string(raw)
	a.mu.Lock()
	session := a.locals[id]
	if session == nil || session.attached {
		a.mu.Unlock()
		stream.Close()
		return
	}
	session.attached = true
	session.timer.Stop()
	a.mu.Unlock()
	defer a.CloseLocalTerminal(id)
	if err := terminal.RelayIO(session.pty, session.pty, session.done, session.close, session.waitError, nil, stream, a.applicationInputAllowed); err != nil && stream.Context().Err() == nil {
		select {
		case <-session.done:
			if exitErr := session.waitError(); exitErr != nil {
				err = exitErr
			} else if errors.Is(err, os.ErrClosed) {
				return
			}
		default:
		}
		application.Get().Event.Emit("terminal:error", map[string]any{"id": id, "error": err.Error(), "error_message": appmessage.Describe(err)})
	}
}
