package app

import (
	"context"
	"encoding/base64"

	"io"
	"net"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/Sanjeever/termquay/internal/docker"
	appmessage "github.com/Sanjeever/termquay/internal/message"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type containerTerminal struct {
	workspace, execID string
	client            *docker.Client
	stream            io.ReadWriteCloser
	output            *io.PipeReader
	writer            *io.PipeWriter
	done              chan struct{}
	cancel            context.CancelFunc
	timer             *time.Timer
	attached          bool
	once              sync.Once
	mu                sync.Mutex
	err               error
}

func (c *containerTerminal) close() {
	c.once.Do(func() {
		c.cancel()
		c.timer.Stop()
		c.stream.Close()
		c.output.Close()
		c.writer.Close()
		c.client.Close()
	})
}

func (a *AppService) dockerClient(ctx context.Context, workspace, socket string) (*docker.Client, context.Context, func(), error) {
	if !path.IsAbs(socket) || path.Clean(socket) != socket || len(socket) > 4096 || strings.ContainsAny(socket, "\x00\r\n") {
		return nil, nil, nil, appmessage.New("backend:dockerSocketMustBeAnAbsoluteRemoteUnix", "Docker socket 必须是远端 Unix 绝对路径")
	}
	a.mu.Lock()
	owner := a.workspaces[workspace]
	if a.commandSlots == nil {
		a.commandSlots = make(chan struct{}, 4)
	}
	slots := a.commandSlots
	a.mu.Unlock()
	if owner == nil {
		return nil, nil, nil, appmessage.New("backend:sSHWorkspaceClosed", "SSH 工作区已关闭")
	}
	ctx, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(owner.ctx, cancel)
	select {
	case slots <- struct{}{}:
	case <-ctx.Done():
		stop()
		cancel()
		return nil, nil, nil, ctx.Err()
	}
	client := docker.New(func(ctx context.Context) (net.Conn, error) { return owner.terminal.DialSocket(ctx, socket) })
	release := func() { stop(); cancel(); client.Close(); <-slots }
	if err := client.Negotiate(ctx); err != nil {
		release()
		return nil, nil, nil, err
	}
	return client, ctx, release, nil
}
func (a *AppService) ListContainers(ctx context.Context, workspace, socket string) ([]docker.Container, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	client, ctx, release, err := a.dockerClient(ctx, workspace, socket)
	if err != nil {
		return nil, err
	}
	defer release()
	return client.List(ctx)
}
func (a *AppService) InspectContainer(ctx context.Context, workspace, socket, id string) (docker.Details, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	client, ctx, release, err := a.dockerClient(ctx, workspace, socket)
	if err != nil {
		return docker.Details{}, err
	}
	defer release()
	return client.Inspect(ctx, id)
}
func (a *AppService) ReadContainerLogs(ctx context.Context, workspace, socket, id string) (docker.Logs, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	client, ctx, release, err := a.dockerClient(ctx, workspace, socket)
	if err != nil {
		return docker.Logs{}, err
	}
	defer release()
	return client.Logs(ctx, id)
}

func (a *AppService) ReadContainerStats(ctx context.Context, workspace, socket, id string) (docker.Stats, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	client, ctx, release, err := a.dockerClient(ctx, workspace, socket)
	if err != nil {
		return docker.Stats{}, err
	}
	defer release()
	return client.Stats(ctx, id)
}

func (a *AppService) ChangeContainerState(ctx context.Context, workspace, socket, id, action string) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	client, ctx, release, err := a.dockerClient(ctx, workspace, socket)
	if err != nil {
		return err
	}
	defer release()
	return client.ChangeState(ctx, id, action)
}
func (a *AppService) OpenContainerTerminal(ctx context.Context, workspace, socket, id, shell string) (OpenResult, error) {
	if !path.IsAbs(socket) || path.Clean(socket) != socket || len(socket) > 4096 || strings.ContainsAny(socket, "\x00\r\n") {
		return OpenResult{}, appmessage.New("backend:dockerSocketMustBeAnAbsoluteRemoteUnix", "Docker socket 必须是远端 Unix 绝对路径")
	}
	a.mu.Lock()
	owner := a.workspaces[workspace]
	count := 0
	for _, console := range a.containerTerminals {
		if console.workspace == workspace {
			count++
		}
	}
	if a.closed || owner == nil || count+owner.opening >= 4 || len(a.terminals)+len(a.containerTerminals)+a.opening >= 64 {
		a.mu.Unlock()
		return OpenResult{}, appmessage.New("backend:workspaceClosedOrContainerTerminalLimitReached4", "工作区已关闭或容器终端达到上限（每工作区 4 个，全局终端 64 个）")
	}
	a.opening++
	owner.opening++
	a.mu.Unlock()
	defer func() { a.mu.Lock(); a.opening--; owner.opening--; a.mu.Unlock() }()
	life, cancel := context.WithCancel(owner.ctx)
	stop := context.AfterFunc(ctx, cancel)
	defer stop()
	timeout := time.AfterFunc(20*time.Second, cancel)
	defer timeout.Stop()
	client := docker.New(func(ctx context.Context) (net.Conn, error) { return owner.terminal.DialSocket(ctx, socket) })
	if err := client.Negotiate(life); err != nil {
		client.Close()
		cancel()
		return OpenResult{}, err
	}
	execID, stream, err := client.OpenConsole(life, id, shell)
	if err != nil {
		client.Close()
		cancel()
		return OpenResult{}, err
	}
	if !timeout.Stop() || life.Err() != nil || ctx.Err() != nil {
		stream.Close()
		client.Close()
		cancel()
		return OpenResult{}, appmessage.New("backend:containerTerminalCreationCanceledOrTimedOut", "容器终端创建已取消或超时")
	}
	reader, writer := io.Pipe()
	console := &containerTerminal{workspace: workspace, execID: execID, client: client, stream: stream, output: reader, writer: writer, done: make(chan struct{}), cancel: cancel}
	key := base64.RawURLEncoding.EncodeToString(randomBytes(24))
	a.mu.Lock()
	if a.closed || a.workspaces[workspace] != owner {
		a.mu.Unlock()
		stream.Close()
		reader.Close()
		writer.Close()
		client.Close()
		cancel()
		return OpenResult{}, appmessage.New("backend:sSHWorkspaceClosed", "SSH 工作区已关闭")
	}
	if a.containerTerminals == nil {
		a.containerTerminals = map[string]*containerTerminal{}
	}
	a.containerTerminals[key] = console
	console.timer = time.AfterFunc(15*time.Second, func() { a.CloseContainerTerminal(key) })
	a.mu.Unlock()
	go func() {
		_, err := io.Copy(writer, stream)
		console.mu.Lock()
		console.err = err
		console.mu.Unlock()
		writer.Close()
		close(console.done)
	}()
	return OpenResult{ID: key}, nil
}
func (a *AppService) ResizeContainerTerminal(ctx context.Context, id string, cols, rows int) error {
	a.mu.Lock()
	console := a.containerTerminals[id]
	a.mu.Unlock()
	if console == nil {
		return appmessage.New("backend:containerTerminalClosed", "容器终端已关闭")
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return console.client.Resize(ctx, console.execID, cols, rows)
}
func (a *AppService) CloseContainerTerminal(id string) {
	a.mu.Lock()
	console := a.containerTerminals[id]
	delete(a.containerTerminals, id)
	a.mu.Unlock()
	if console != nil {
		console.close()
	}
}
func (a *AppService) handleContainerTerminal(stream *application.StreamConn) {
	defer stream.Close()
	deadline := time.AfterFunc(5*time.Second, func() { stream.Close() })
	frame, err := stream.Receive()
	deadline.Stop()
	if err != nil || len(frame) > 64 {
		return
	}
	id := string(frame)
	a.mu.Lock()
	console := a.containerTerminals[id]
	if console == nil || console.attached {
		a.mu.Unlock()
		return
	}
	console.attached = true
	console.timer.Stop()
	a.mu.Unlock()
	defer a.CloseContainerTerminal(id)
	err = terminal.RelayIO(console.stream, console.output, console.done, console.close, func() error { console.mu.Lock(); defer console.mu.Unlock(); return console.err }, nil, stream, a.applicationInputAllowed)
	if err != nil && stream.Context().Err() == nil {
		application.Get().Event.Emit("terminal:error", map[string]any{"id": id, "error": err.Error(), "error_message": appmessage.Describe(err)})
	}
}
