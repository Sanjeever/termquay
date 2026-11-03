package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
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
	TrustHost     string `json:"trust_host,omitempty"`
	TrustPort     int    `json:"trust_port,omitempty"`
	TrustVia      string `json:"trust_via,omitempty"`
	TrustRole     string `json:"trust_role,omitempty"`
}

type pendingTerminal struct {
	terminal  *terminal.Terminal
	timer     *time.Timer
	attached  bool
	workspace string
}

type workspaceOwner struct {
	target   string
	identity string
	terminal *terminal.Terminal
	ctx      context.Context
	cancel   context.CancelFunc
	timer    *time.Timer
	stream   *application.StreamConn
	opening  int
	route    []latencyHop
}

type AppService struct {
	importPreview          *SSHImportPreview
	mu                     sync.Mutex
	terminals              map[string]*pendingTerminal
	workspaces             map[string]*workspaceOwner
	trusted                map[string]string
	pendingTrust           map[string]string
	opening                int
	closed                 bool
	rdp                    *rdp.Bridge
	storeMu                sync.Mutex
	store                  *store.Store
	sessionDir             string
	backupMu               sync.Mutex
	preview                *pendingRestore
	fileSlots              chan struct{}
	monitors               map[string]context.CancelFunc
	transfers              map[string]*transferTask
	transferQueue          []string
	transferSequence       uint64
	transferEvent          func(Transfer)
	syncPlans              map[string]*directorySyncPlan
	syncOpening            int
	dirty                  map[string]bool
	views                  map[string]bool
	allowQuit              bool
	frontendReady          bool
	privateKeys            map[string]stagedPrivateKey
	tunnels                map[string]*workspaceTunnel
	closing                int
	trustEpoch             map[string]uint64
	trustReviews           map[string]TrustReview
	pendingTrustAt         map[string]time.Time
	pendingTrustGeneration map[string]uint64
	sshChallenges          map[string]*sshAuthentication
	transferRate           atomic.Int64
	commandSlots           chan struct{}
	automaticMu            sync.Mutex
	automaticConfig        *automaticBackupConfig
	automaticStatus        AutomaticBackupStatus
	automaticLoaded        bool
	automaticSignal        chan struct{}
	automaticStop          context.CancelFunc
	automaticTaskCancel    context.CancelFunc
	automaticDone          chan struct{}
	locals                 map[string]*localTerminal
	localOpening           int
	latencyProbes          map[string]*latencyProbe
}

func NewAppService() *AppService {
	return &AppService{terminals: map[string]*pendingTerminal{}, workspaces: map[string]*workspaceOwner{}, trusted: map[string]string{}, pendingTrust: map[string]string{}, fileSlots: make(chan struct{}, 4), monitors: map[string]context.CancelFunc{}, transfers: map[string]*transferTask{}, dirty: map[string]bool{}, views: map[string]bool{}, syncPlans: map[string]*directorySyncPlan{}, privateKeys: map[string]stagedPrivateKey{}, tunnels: map[string]*workspaceTunnel{}, transferEvent: func(view Transfer) { application.Get().Event.Emit("transfer:changed", view) }}
}

func (a *AppService) OpenTerminal(ctx context.Context, r terminal.Request) (OpenResult, error) {
	if r.ProxyAddress != "" && r.JumpID != "" {
		return OpenResult{}, errors.New("目标不能同时配置跳板与连接代理，请在首个跳板配置代理")
	}
	challenge, release, err := a.beginSSHAuthentication(ctx, r.AuthID)
	if err != nil {
		return OpenResult{}, err
	}
	defer release()
	r = terminal.WithChallenge(r, challenge)
	if err := a.resolvePrivateKey(&r); err != nil {
		return OpenResult{}, err
	}
	chain, err := a.resolveSSHChain(r)
	if err != nil {
		return OpenResult{}, err
	}
	epochs := map[string]uint64{}
	a.mu.Lock()
	for _, request := range chain {
		key := sshTrustKey(request.Host, request.Port, request.JumpID)
		epochs[key] = a.trustEpoch[key]
	}
	a.mu.Unlock()
	stored := map[string]string{}
	for _, request := range chain {
		key := sshTrustKey(request.Host, request.Port, request.JumpID)
		stored[key], err = a.readTrust("ssh:" + key)
		if err != nil {
			return OpenResult{}, err
		}
	}
	unchanged := func() bool {
		for key, epoch := range epochs {
			if a.trustEpoch[key] != epoch {
				return false
			}
		}
		return true
	}
	a.mu.Lock()
	if !unchanged() {
		a.mu.Unlock()
		return OpenResult{}, errors.New("信任记录已变化，请重新连接")
	}
	if a.closed || len(a.workspaces)+a.opening+a.closing >= 16 || len(a.terminals)+a.opening >= 64 {
		a.mu.Unlock()
		return OpenResult{}, errors.New("当前最多运行 16 个终端")
	}
	fingerprints := []string{}
	for index, request := range chain {
		key := sshTrustKey(request.Host, request.Port, request.JumpID)
		if stored[key] != "" {
			a.trusted[key] = stored[key]
		}
		request.Fingerprint = a.trusted[key]
		chain[index] = terminal.WithChallenge(request, challenge)
		fingerprints = append(fingerprints, request.Fingerprint)
	}
	r = chain[len(chain)-1]
	a.opening++
	a.mu.Unlock()
	defer func() { a.mu.Lock(); a.opening--; a.mu.Unlock() }()
	t, err := terminal.DialChain(ctx, chain)
	if err != nil {
		var identity *terminal.HostKeyError
		if errors.As(err, &identity) {
			via := identity.Via
			role := ""
			if len(chain) > 1 {
				role = "target"
			}
			if identity.Jump {
				role = "jump"
			}
			identityKey := sshTrustKey(identity.Host, identity.Port, via)
			a.mu.Lock()
			defer a.mu.Unlock()
			if a.trusted[identityKey] != "" {
				return OpenResult{}, errors.New("SSH 主机密钥已变化，连接已阻止")
			}
			if !unchanged() {
				return OpenResult{}, errors.New("身份探测已失效")
			}
			if err = a.setPendingTrustLocked(identityKey, identity.Fingerprint); err != nil {
				return OpenResult{}, err
			}
			return OpenResult{Fingerprint: identity.Fingerprint, TrustRequired: true, TrustHost: identity.Host, TrustPort: identity.Port, TrustVia: via, TrustRole: role}, nil
		}
		return OpenResult{}, err
	}
	if err = ctx.Err(); err != nil {
		t.Disconnect()
		return OpenResult{}, err
	}
	id := base64.RawURLEncoding.EncodeToString(randomBytes(24))
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closed {
		t.Close()
		return OpenResult{}, errors.New("应用正在关闭")
	}
	if !unchanged() {
		t.Disconnect()
		return OpenResult{}, errors.New("信任记录已变化，请重新连接")
	}
	t.KeepConnection()
	ownerCtx, ownerCancel := context.WithCancel(context.Background())
	owner := &workspaceOwner{terminal: t, ctx: ownerCtx, cancel: ownerCancel, target: r.Username + "@" + net.JoinHostPort(r.Host, strconv.Itoa(r.Port)), identity: strings.Join(fingerprints, "/") + ":" + r.JumpID}
	for _, request := range chain {
		owner.route = append(owner.route, latencyHop{request.Host, request.Port, request.Username, request.JumpID, request.ProxyAddress})
	}
	a.workspaces[id] = owner
	go func() { t.WaitConnection(); a.CloseWorkspace(id) }()
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
	return a.TrustSSHHost(host, port, fingerprint, "")
}
func sshTrustKey(host string, port int, via string) string {
	address := net.JoinHostPort(host, strconv.Itoa(port))
	if via != "" {
		return "via:" + via + ":" + address
	}
	return address
}
func (a *AppService) TrustSSHHost(host string, port int, fingerprint, via string) error {
	address := sshTrustKey(host, port, via)
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.pendingTrustValidLocked(address, fingerprint) || a.trusted[address] != "" {
		return errors.New("主机信任请求无效")
	}
	if err := a.saveTrust("ssh:"+address, fingerprint); err != nil {
		return err
	}
	a.trusted[address] = fingerprint
	delete(a.pendingTrust, address)
	delete(a.pendingTrustAt, address)
	delete(a.pendingTrustGeneration, address)
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
	if owner != nil {
		a.closing++
		defer func() { a.mu.Lock(); a.closing--; a.mu.Unlock() }()
	}
	forwarding := []*workspaceTunnel{}
	for key, t := range a.tunnels {
		if t.view.Workspace == id {
			t.cancel()
			forwarding = append(forwarding, t)
			delete(a.tunnels, key)
		}
	}
	if owner != nil {
		owner.cancel()
	}
	for key, p := range a.syncPlans {
		if p.workspace == id {
			delete(a.syncPlans, key)
		}
	}
	pendingTransfers := []<-chan struct{}{}
	for _, task := range a.transfers {
		if task.view.Workspace == id {
			a.cancelTransferLocked(task)
			pendingTransfers = append(pendingTransfers, task.done)
		}
	}
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
	for _, t := range forwarding {
		if t.forward != nil {
			t.forward.Close()
		}
	}
	if cancel != nil {
		cancel()
	}
	for _, p := range terminals {
		p.timer.Stop()
	}
	wait, cancelWait := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelWait()
	for _, done := range pendingTransfers {
		select {
		case <-done:
		case <-wait.Done():
		}
	}
	if owner != nil {
		owner.timer.Stop()
		if owner.stream != nil {
			owner.stream.Close()
		}
		owner.terminal.Disconnect()
	}
	for _, p := range terminals {
		p.terminal.Close()
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

func (a *AppService) ServiceShutdown() (result error) {
	defer func() { result = errors.Join(result, a.cleanupLocalTransferResumes()) }()
	a.mu.Lock()
	a.closed = true
	for _, probe := range a.latencyProbes {
		probe.cancel()
	}
	localIDs := []string{}
	for id := range a.locals {
		localIDs = append(localIDs, id)
	}
	for id, key := range a.privateKeys {
		key.timer.Stop()
		clear(key.data)
		delete(a.privateKeys, id)
	}
	ids := make([]string, 0, len(a.workspaces))
	for id := range a.workspaces {
		ids = append(ids, id)
	}
	a.mu.Unlock()
	a.stopAutomaticBackup()
	for _, id := range localIDs {
		a.CloseLocalTerminal(id)
	}
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
