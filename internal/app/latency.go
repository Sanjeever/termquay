package app

import (
	"context"
	"errors"
	"net"
	"slices"
	"strconv"
	"time"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"github.com/Sanjeever/termquay/internal/store"
)

type ConnectionLatency struct {
	Milliseconds float64                `json:"milliseconds"`
	Status       string                 `json:"status"`
	Error        string                 `json:"error,omitempty"`
	ErrorMessage *appmessage.Descriptor `json:"error_message,omitempty"`
}

type latencyHop struct {
	host         string
	port         int
	username     string
	jumpID       string
	proxyAddress string
}

type latencyProbe struct {
	cancel context.CancelFunc
	done   chan struct{}
	result ConnectionLatency
	err    error
}

func (a *AppService) MeasureConnectionLatency(ctx context.Context, id string) (result ConnectionLatency, err error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	var probe *latencyProbe
	for {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		a.mu.Lock()
		if a.closed {
			a.mu.Unlock()
			return result, appmessage.New("backend:applicationIsClosing", "应用正在关闭")
		}
		if pending := a.latencyProbes[id]; pending != nil {
			a.mu.Unlock()
			select {
			case <-pending.done:
				if errors.Is(pending.err, context.Canceled) {
					continue
				}
				return pending.result, pending.err
			case <-ctx.Done():
				return result, ctx.Err()
			}
		}
		if len(a.latencyProbes) >= 8 {
			a.mu.Unlock()
			return result, appmessage.New("backend:concurrentLatencyProbeLimitReachedRefreshShortly", "延迟探测并发达到上限，请稍后刷新")
		}
		probe = &latencyProbe{cancel: cancel, done: make(chan struct{})}
		if a.latencyProbes == nil {
			a.latencyProbes = map[string]*latencyProbe{}
		}
		a.latencyProbes[id] = probe
		a.mu.Unlock()
		break
	}
	defer func() {
		cancel()
		a.mu.Lock()
		probe.result, probe.err = result, err
		delete(a.latencyProbes, id)
		close(probe.done)
		a.mu.Unlock()
	}()
	connection, hops, err := a.latencyRoute(ctx, id)
	if err != nil {
		return result, err
	}
	var elapsed time.Duration
	if len(hops) == 0 {
		elapsed, err = terminal.MeasureTCP(ctx, terminal.Request{Host: connection.Host, Port: connection.Port, ProxyAddress: connection.ProxyAddress})
	} else {
		a.mu.Lock()
		var owner *workspaceOwner
		for _, candidate := range a.workspaces {
			if candidate.ctx.Err() == nil && len(candidate.route) >= len(hops) && slices.Equal(candidate.route[:len(hops)], hops) {
				owner = candidate
				break
			}
		}
		a.mu.Unlock()
		if owner == nil {
			return ConnectionLatency{Status: "jump_required", Error: "需先连接配置中的跳板，或建立使用同一跳板链的 SSH 工作区", ErrorMessage: appmessage.Describe(appmessage.New("backend:connectJumpHostFirst", "需先连接配置中的跳板，或建立使用同一跳板链的 SSH 工作区"))}, nil
		}
		stop := context.AfterFunc(owner.ctx, cancel)
		elapsed, err = owner.terminal.MeasureHopTCP(ctx, len(hops)-1, net.JoinHostPort(connection.Host, strconv.Itoa(connection.Port)))
		stop()
	}
	if err != nil {
		if errors.Is(ctx.Err(), context.Canceled) {
			return result, ctx.Err()
		}
		status := "error"
		var networkError net.Error
		if errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &networkError) && networkError.Timeout()) {
			status = "timeout"
		}
		return ConnectionLatency{Status: status, Error: err.Error(), ErrorMessage: appmessage.Describe(err)}, nil
	}
	return ConnectionLatency{Milliseconds: float64(elapsed) / float64(time.Millisecond), Status: "ok"}, nil
}

func (a *AppService) latencyRoute(ctx context.Context, id string) (store.Connection, []latencyHop, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return store.Connection{}, nil, err
	}
	connection, err := a.store.Connection(ctx, id)
	if err != nil {
		return store.Connection{}, nil, err
	}
	hops := []latencyHop{}
	seen := map[string]bool{id: true}
	for jumpID := connection.JumpID; jumpID != ""; {
		if seen[jumpID] || len(hops) >= 4 {
			return connection, nil, appmessage.New("backend:sSHJumpChainContainsACycleOrExceeds", "SSH 跳板链存在循环或超过四跳")
		}
		seen[jumpID] = true
		jump, err := a.store.Connection(ctx, jumpID)
		if err != nil {
			return connection, nil, err
		}
		if jump.Protocol != "ssh" {
			return connection, nil, appmessage.New("backend:jumpHostsMustUseSSHConfigurations", "跳板必须使用 SSH 配置")
		}
		hops = append(hops, latencyHop{jump.Host, jump.Port, jump.Username, jump.JumpID, jump.ProxyAddress})
		jumpID = jump.JumpID
	}
	slices.Reverse(hops)
	return connection, hops, nil
}
