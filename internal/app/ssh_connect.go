package app

import (
	"context"
	"encoding/base64"
	"errors"
	"net"
	"strconv"
	"strings"
	"time"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
)

func (a *AppService) OpenTerminal(ctx context.Context, r terminal.Request) (result OpenResult, failure error) {
	return a.openTerminal(ctx, r, nil)
}

func (a *AppService) openTerminal(ctx context.Context, r terminal.Request, expected []SSHRouteHop) (result OpenResult, failure error) {
	connectionID := r.ConnectionID
	if r.ProxyAddress != "" && r.JumpID != "" {
		return OpenResult{}, appmessage.New("backend:aDestinationCannotConfigureBothAJumpHost", "目标不能同时配置跳板与连接代理，请在首个跳板配置代理")
	}
	challenge, release, err := a.beginSSHAuthentication(ctx, r.AuthID)
	if err != nil {
		return OpenResult{}, err
	}
	defer release()
	progress := &connectionProgress{}
	a.mu.Lock()
	if state := a.sshChallenges[r.AuthID]; state != nil {
		progress = state.progress
	}
	a.mu.Unlock()
	defer func() {
		result.Steps = progress.snapshot()
		if failure != nil {
			failure = &SSHConnectionFailure{Message: failure.Error(), Steps: result.Steps, err: failure}
		}
	}()
	r = terminal.WithChallenge(r, challenge)
	if err := a.resolvePrivateKey(&r); err != nil {
		return OpenResult{}, err
	}
	chain, err := a.resolveSSHChain(r)
	if err != nil {
		return OpenResult{}, err
	}
	route := sshRoute(chain)
	if expected != nil {
		if err := validateReconnectRoute(route, expected); err != nil {
			return OpenResult{}, err
		}
	}
	for i := range chain {
		chain[i] = terminal.WithConnectionProgress(chain[i], i+1, len(chain), progress.record)
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
		return OpenResult{}, appmessage.New("backend:trustRecordChangedConnectAgain", "信任记录已变化，请重新连接")
	}
	if a.closed || len(a.workspaces)+a.opening+a.closing >= 16 || len(a.terminals)+len(a.containerTerminals)+a.opening >= 64 {
		a.mu.Unlock()
		return OpenResult{}, appmessage.New("backend:concurrentTerminalLimitReached16", "当前最多运行 16 个终端")
	}
	fingerprints := make([]string, len(chain))
	for index, request := range chain {
		key := sshTrustKey(request.Host, request.Port, request.JumpID)
		if stored[key] != "" {
			a.trusted[key] = stored[key]
		}
		request.Fingerprint = a.trusted[key]
		chain[index] = terminal.WithVerifiedHostKey(terminal.WithChallenge(request, challenge), func(fingerprint string) { fingerprints[index] = fingerprint })
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
				return OpenResult{}, appmessage.New("backend:sSHHostKeyChangedConnectionBlocked", "SSH 主机密钥已变化，连接已阻止")
			}
			if !unchanged() {
				return OpenResult{}, appmessage.New("backend:identityProbeExpired", "身份探测已失效")
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
		return OpenResult{}, appmessage.New("backend:applicationIsClosing", "应用正在关闭")
	}
	if !unchanged() {
		t.Disconnect()
		return OpenResult{}, appmessage.New("backend:trustRecordChangedConnectAgain", "信任记录已变化，请重新连接")
	}
	t.KeepConnection()
	ownerCtx, ownerCancel := context.WithCancel(context.Background())
	owner := &workspaceOwner{terminal: t, ctx: ownerCtx, cancel: ownerCancel, target: r.Username + "@" + net.JoinHostPort(r.Host, strconv.Itoa(r.Port)), identity: strings.Join(fingerprints, "/") + ":" + r.JumpID}
	owner.connectionID = connectionID
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
	return OpenResult{ID: id, Route: route}, nil
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
		return appmessage.New("backend:invalidHostTrustRequest", "主机信任请求无效")
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
