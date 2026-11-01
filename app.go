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
	"github.com/wailsapp/wails/v3/pkg/application"
)

type OpenResult struct {
	ID            string `json:"id"`
	Fingerprint   string `json:"fingerprint"`
	TrustRequired bool   `json:"trust_required"`
}

type pendingTerminal struct {
	terminal *terminal.Terminal
	timer    *time.Timer
	attached bool
}

type AppService struct {
	mu           sync.Mutex
	terminals    map[string]*pendingTerminal
	trusted      map[string]string
	pendingTrust map[string]string
	opening      int
	closed       bool
	rdp          *rdp.Bridge
}

func NewAppService() *AppService {
	return &AppService{terminals: map[string]*pendingTerminal{}, trusted: map[string]string{}, pendingTrust: map[string]string{}}
}

func (a *AppService) OpenTerminal(ctx context.Context, r terminal.Request) (OpenResult, error) {
	a.mu.Lock()
	if a.closed || len(a.terminals)+a.opening >= 16 {
		a.mu.Unlock()
		return OpenResult{}, errors.New("当前最多运行 16 个终端")
	}
	address := net.JoinHostPort(r.Host, strconv.Itoa(r.Port))
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
	pending := &pendingTerminal{terminal: t}
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
	a.trusted[address] = fingerprint
	delete(a.pendingTrust, address)
	return nil
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
	ids := make([]string, 0, len(a.terminals))
	for id := range a.terminals {
		ids = append(ids, id)
	}
	a.mu.Unlock()
	for _, id := range ids {
		a.CloseTerminal(id)
	}
	if a.rdp != nil {
		return a.rdp.Close()
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
