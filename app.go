package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net"
	"strconv"
	"sync"
	"time"

	"github.com/Sanjeever/termquay/internal/rdp"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"github.com/Sanjeever/termquay/internal/store"
	"github.com/wailsapp/wails/v3/pkg/application"
	"os"
)

type OpenResult struct {
	ID            string `json:"id"`
	Fingerprint   string `json:"fingerprint"`
	TrustRequired bool   `json:"trust_required"`
}

type pendingTerminal struct {
	terminal  *terminal.Terminal
	timer     *time.Timer
	attached  bool
	workspace string
}

type workspaceOwner struct {
	terminal *terminal.Terminal
	timer    *time.Timer
	stream   *application.StreamConn
	opening  int
}

type AppService struct {
	mu           sync.Mutex
	terminals    map[string]*pendingTerminal
	workspaces   map[string]*workspaceOwner
	trusted      map[string]string
	pendingTrust map[string]string
	opening      int
	closed       bool
	rdp          *rdp.Bridge
	storeMu      sync.Mutex
	store        *store.Store
	sessionDir   string
	backupMu     sync.Mutex
	preview      *pendingRestore
	fileSlots    chan struct{}
	monitors     map[string]context.CancelFunc
}

func NewAppService() *AppService {
	return &AppService{terminals: map[string]*pendingTerminal{}, workspaces: map[string]*workspaceOwner{}, trusted: map[string]string{}, pendingTrust: map[string]string{}, fileSlots: make(chan struct{}, 4), monitors: map[string]context.CancelFunc{}}
}

func (a *AppService) OpenTerminal(ctx context.Context, r terminal.Request) (OpenResult, error) {
	address := net.JoinHostPort(r.Host, strconv.Itoa(r.Port))
	stored, err := a.readTrust("ssh:" + address)
	if err != nil {
		return OpenResult{}, err
	}
	a.mu.Lock()
	if a.closed || len(a.workspaces)+a.opening >= 16 || len(a.terminals)+a.opening >= 64 {
		a.mu.Unlock()
		return OpenResult{}, errors.New("当前最多运行 16 个终端")
	}
	if stored != "" {
		a.trusted[address] = stored
	}
	r.Fingerprint = a.trusted[address]
	a.opening++
	a.mu.Unlock()
	defer func() { a.mu.Lock(); a.opening--; a.mu.Unlock() }()
	t, err := terminal.Dial(ctx, r)
	if err != nil {
		var identity *terminal.HostKeyError
		if errors.As(err, &identity) {
			a.mu.Lock()
			defer a.mu.Unlock()
			if a.trusted[address] != "" {
				return OpenResult{}, errors.New("SSH 主机密钥已变化，连接已阻止")
			}
			a.pendingTrust[address] = identity.Fingerprint
			return OpenResult{Fingerprint: identity.Fingerprint, TrustRequired: true}, nil
		}
		return OpenResult{}, err
	}
	id := base64.RawURLEncoding.EncodeToString(randomBytes(24))
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closed {
		t.Close()
		return OpenResult{}, errors.New("应用正在关闭")
	}
	t.KeepConnection()
	owner := &workspaceOwner{terminal: t}
	a.workspaces[id] = owner
	owner.timer = time.AfterFunc(15*time.Second, func() {
		a.mu.Lock()
		p := a.workspaces[id]
		unattached := p != nil && p.stream == nil
		a.mu.Unlock()
		if unattached {
			a.CloseWorkspace(id)
		}
	})
	pending := &pendingTerminal{terminal: t, workspace: id}
	a.terminals[id] = pending
	pending.timer = time.AfterFunc(15*time.Second, func() {
		a.mu.Lock()
		p, ok := a.terminals[id]
		if ok && !p.attached {
			delete(a.terminals, id)
			p.terminal.Close()
		}
		a.mu.Unlock()
	})
	return OpenResult{ID: id}, nil
}

func (a *AppService) TrustHost(host string, port int, fingerprint string) error {
	address := net.JoinHostPort(host, strconv.Itoa(port))
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.pendingTrust[address] != fingerprint || fingerprint == "" || a.trusted[address] != "" {
		return errors.New("主机信任请求无效")
	}
	if err := a.saveTrust("ssh:"+address, fingerprint); err != nil {
		return err
	}
	a.trusted[address] = fingerprint
	delete(a.pendingTrust, address)
	return nil
}

func (a *AppService) readTrust(id string) (string, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if a.store == nil {
		return "", nil
	}
	return a.store.Setting("trust:" + id)
}
func (a *AppService) saveTrust(id, value string) error {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if a.store == nil {
		return nil
	}
	return a.store.SetSetting("trust:"+id, value)
}

func (a *AppService) ResizeTerminal(id string, cols, rows int) error {
	a.mu.Lock()
	p := a.terminals[id]
	a.mu.Unlock()
	if p == nil {
		return errors.New("终端已关闭")
	}
	return p.terminal.Resize(cols, rows)
}

func (a *AppService) CloseTerminal(id string) {
	a.mu.Lock()
	p := a.terminals[id]
	delete(a.terminals, id)
	a.mu.Unlock()
	if p != nil {
		p.timer.Stop()
		p.terminal.Close()
	}
}

func (a *AppService) CreateTerminal(workspace string) (OpenResult, error) {
	a.mu.Lock()
	owner := a.workspaces[workspace]
	count := 0
	for _, p := range a.terminals {
		if p.workspace == workspace {
			count++
		}
	}
	if owner == nil || a.closed || count+owner.opening >= 8 || len(a.terminals)+a.opening >= 64 {
		a.mu.Unlock()
		return OpenResult{}, errors.New("工作区已关闭或终端达到上限（每工作区 8 个，全局 64 个）")
	}
	a.opening++
	owner.opening++
	a.mu.Unlock()
	defer func() { a.mu.Lock(); a.opening--; owner.opening--; a.mu.Unlock() }()
	t, err := owner.terminal.OpenPTY(100, 30)
	if err != nil {
		return OpenResult{}, err
	}
	id := base64.RawURLEncoding.EncodeToString(randomBytes(24))
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.workspaces[workspace] != owner {
		t.Close()
		return OpenResult{}, errors.New("工作区已关闭")
	}
	p := &pendingTerminal{terminal: t, workspace: workspace}
	a.terminals[id] = p
	p.timer = time.AfterFunc(15*time.Second, func() {
		a.mu.Lock()
		pending := a.terminals[id]
		unattached := pending != nil && !pending.attached
		a.mu.Unlock()
		if unattached {
			a.CloseTerminal(id)
		}
	})
	return OpenResult{ID: id}, nil
}

func (a *AppService) CloseWorkspace(id string) {
	a.mu.Lock()
	owner := a.workspaces[id]
	delete(a.workspaces, id)
	cancel := a.monitors[id]
	delete(a.monitors, id)
	terminals := []*pendingTerminal{}
	for key, p := range a.terminals {
		if p.workspace == id {
			terminals = append(terminals, p)
			delete(a.terminals, key)
		}
	}
	a.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	for _, p := range terminals {
		p.timer.Stop()
		p.terminal.Close()
	}
	if owner != nil {
		owner.timer.Stop()
		if owner.stream != nil {
			owner.stream.Close()
		}
		owner.terminal.Disconnect()
	}
}

func (a *AppService) handleWorkspace(c *application.StreamConn) {
	deadline := time.AfterFunc(5*time.Second, func() { c.Close() })
	raw, err := c.Receive()
	deadline.Stop()
	if err != nil {
		return
	}
	id := string(raw)
	a.mu.Lock()
	owner := a.workspaces[id]
	if owner == nil || owner.stream != nil {
		a.mu.Unlock()
		return
	}
	owner.stream = c
	owner.timer.Stop()
	a.mu.Unlock()
	defer a.CloseWorkspace(id)
	<-c.Context().Done()
}

func (a *AppService) handleTerminal(c *application.StreamConn) {
	deadline := time.AfterFunc(5*time.Second, func() { c.Close() })
	frame, err := c.Receive()
	deadline.Stop()
	if err != nil {
		return
	}
	id := string(frame)
	a.mu.Lock()
	p := a.terminals[id]
	if p == nil || p.attached {
		a.mu.Unlock()
		return
	}
	p.attached = true
	p.timer.Stop()
	a.mu.Unlock()
	defer a.CloseTerminal(id)
	if err = terminal.Relay(p.terminal, c); err != nil && c.Context().Err() == nil {
		application.Get().Event.Emit("terminal:error", map[string]string{"id": id, "error": err.Error()})
	}
}

func (a *AppService) ServiceShutdown() error {
	a.mu.Lock()
	a.closed = true
	ids := make([]string, 0, len(a.workspaces))
	for id := range a.workspaces {
		ids = append(ids, id)
	}
	a.mu.Unlock()
	for _, id := range ids {
		a.CloseWorkspace(id)
	}
	if a.rdp != nil {
		a.rdp.Close()
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if a.store != nil {
		if err := a.store.Close(); err != nil {
			return err
		}
	}
	if a.sessionDir != "" {
		return os.RemoveAll(a.sessionDir)
	}
	return nil
}

func randomBytes(n int) []byte {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return b
}
