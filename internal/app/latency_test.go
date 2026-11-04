package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Sanjeever/termquay/internal/store"
	socks "github.com/armon/go-socks5"
)

func TestConnectionLatencyDirectAndUnavailableJump(t *testing.T) {
	a := testAppStore(t)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	go func() {
		conn, err := listener.Accept()
		if err == nil {
			conn.Close()
		}
	}()
	host, port, _ := net.SplitHostPort(listener.Addr().String())
	number, _ := strconv.Atoi(port)
	connection := store.Connection{ID: "target", Name: "测试", Protocol: "ssh", Host: host, Port: number, Username: "test"}
	jump := store.Connection{ID: "jump", Name: "跳板", Protocol: "ssh", Host: "jump.invalid", Port: 22, Username: "test"}
	if err := a.store.Replace(store.Data{Connections: []store.Connection{connection, jump}}); err != nil {
		t.Fatal(err)
	}
	result, err := a.MeasureConnectionLatency(t.Context(), connection.ID)
	if err != nil || result.Status != "ok" || result.Milliseconds < 0 {
		t.Fatal("本地 TCP 探测失败", result, err)
	}
	connection.JumpID = jump.ID
	if err := a.store.Replace(store.Data{Connections: []store.Connection{connection, jump}}); err != nil {
		t.Fatal(err)
	}
	result, err = a.MeasureConnectionLatency(t.Context(), connection.ID)
	if err != nil || result.Status != "jump_required" {
		t.Fatal("跳板不可用时未阻止直连", result, err)
	}
}

func latencyTestProxy(t *testing.T) (string, <-chan struct{}, chan<- struct{}, *atomic.Int32) {
	t.Helper()
	entered := make(chan struct{}, 8)
	release := make(chan struct{})
	var calls atomic.Int32
	server, err := socks.New(&socks.Config{Logger: log.New(io.Discard, "", 0), Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
		calls.Add(1)
		entered <- struct{}{}
		select {
		case <-release:
		case <-t.Context().Done():
		}
		return nil, errors.New("测试代理拒绝连接")
	}})
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close(); close(release) })
	go server.Serve(listener)
	return listener.Addr().String(), entered, release, &calls
}

func TestConnectionLatencyCoalescesAndPreservesOwnerOnWaiterCancel(t *testing.T) {
	a := testAppStore(t)
	proxy, entered, release, calls := latencyTestProxy(t)
	if err := a.store.Replace(store.Data{Connections: []store.Connection{{ID: "target", Name: "测试", Protocol: "ssh", Host: "127.0.0.1", Port: 22, Username: "test", ProxyAddress: proxy}}}); err != nil {
		t.Fatal(err)
	}
	completed := make(chan error, 1)
	go func() { _, err := a.MeasureConnectionLatency(t.Context(), "target"); completed <- err }()
	<-entered
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Millisecond)
	defer cancel()
	if _, err := a.MeasureConnectionLatency(ctx, "target"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("等待者未响应取消", err)
	}
	if calls.Load() != 1 {
		t.Fatal("同目标探测未合并")
	}
	a.mu.Lock()
	pending := a.latencyProbes["target"]
	a.mu.Unlock()
	if pending == nil {
		t.Fatal("取消等待者提前释放了原探测")
	}
	release <- struct{}{}
	if err := <-completed; err != nil {
		t.Fatal("原探测被等待者取消", err)
	}
	a.mu.Lock()
	remaining := len(a.latencyProbes)
	a.mu.Unlock()
	if remaining != 0 {
		t.Fatal("探测完成未回收")
	}
}

func TestConnectionLatencyConcurrencyAndCancellation(t *testing.T) {
	a := testAppStore(t)
	proxy, entered, _, _ := latencyTestProxy(t)
	data := store.Data{}
	for index := 0; index < 9; index++ {
		data.Connections = append(data.Connections, store.Connection{ID: fmt.Sprint(index), Name: "测试", Protocol: "ssh", Host: "127.0.0.1", Port: 22, Username: "test", ProxyAddress: proxy})
	}
	if err := a.store.Replace(data); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	completed := make(chan error, 8)
	for index := 0; index < 8; index++ {
		go func() { _, err := a.MeasureConnectionLatency(ctx, fmt.Sprint(index)); completed <- err }()
	}
	for range 8 {
		<-entered
	}
	if _, err := a.MeasureConnectionLatency(t.Context(), "8"); err == nil || !strings.Contains(err.Error(), "并发达到上限") {
		t.Fatal("探测并发未限制", err)
	}
	cancel()
	for range 8 {
		if err := <-completed; !errors.Is(err, context.Canceled) {
			t.Fatal("探测未响应取消", err)
		}
	}
	a.mu.Lock()
	remaining := len(a.latencyProbes)
	a.mu.Unlock()
	if remaining != 0 {
		t.Fatal("取消后未回收探测")
	}
}
