package app

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Sanjeever/termquay/internal/rdp"
	"github.com/bouncyball-git/gopher-rdp/protocol/tpkt"
	gossh "golang.org/x/crypto/ssh"
)

type trustProbeGate struct{ entered, release chan struct{} }

func trustSSHServer(t *testing.T) (TrustRecord, func() string, chan *trustProbeGate) {
	t.Helper()
	var config atomic.Pointer[gossh.ServerConfig]
	rotate := func() string {
		_, private, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		signer, err := gossh.NewSignerFromKey(private)
		if err != nil {
			t.Fatal(err)
		}
		current := &gossh.ServerConfig{NoClientAuth: true}
		current.AddHostKey(signer)
		config.Store(current)
		return gossh.FingerprintSHA256(signer.PublicKey())
	}
	fingerprint := rotate()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	gates := make(chan *trustProbeGate, 1)
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				conn.SetDeadline(time.Now().Add(5 * time.Second))
				select {
				case gate := <-gates:
					close(gate.entered)
					select {
					case <-gate.release:
					case <-t.Context().Done():
						return
					}
				default:
				}
				server, _, _, err := gossh.NewServerConn(conn, config.Load())
				if err == nil {
					server.Close()
				}
			}()
		}
	}()
	host, port, err := net.SplitHostPort(listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	number, err := strconv.Atoi(port)
	if err != nil {
		t.Fatal(err)
	}
	return TrustRecord{Key: "trust:ssh:" + listener.Addr().String(), Protocol: "ssh", Host: host, Port: number, Fingerprint: fingerprint}, rotate, gates
}

func TestTrustReviewReprobesChangedIdentityAndSynchronizesCaches(t *testing.T) {
	a := testAppStore(t)
	record, rotate, _ := trustSSHServer(t)
	if err := a.store.SetSetting(record.Key, record.Fingerprint); err != nil {
		t.Fatal(err)
	}
	cache := trustCacheKey(record)
	a.trusted[cache] = record.Fingerprint
	current := rotate()
	review, err := a.ProbeTrustReview(t.Context(), record.Key)
	if err != nil || review.Old != record.Fingerprint || review.New != current {
		t.Fatalf("身份变化探测错误：%v", err)
	}
	if err = a.ConfirmTrustReview(t.Context(), review.ID); err != nil {
		t.Fatal(err)
	}
	stored, err := a.store.Setting(record.Key)
	if err != nil || stored != current || a.trusted[cache] != current {
		t.Fatal("审核未同步持久记录与缓存")
	}
	review, err = a.ProbeTrustReview(t.Context(), record.Key)
	if err != nil {
		t.Fatal(err)
	}
	rotate()
	if err = a.ConfirmTrustReview(t.Context(), review.ID); err == nil {
		t.Fatal("审核期间再次变化的身份被放行")
	}
	stored, err = a.store.Setting(record.Key)
	if err != nil || stored != current {
		t.Fatal("失败审核覆盖原记录")
	}
}

func TestTrustRevocationInvalidatesInflightConfirmation(t *testing.T) {
	a := testAppStore(t)
	record, _, gates := trustSSHServer(t)
	review, err := a.ProbeTrustReview(t.Context(), record.Key)
	if err != nil {
		t.Fatal(err)
	}
	gate := &trustProbeGate{entered: make(chan struct{}), release: make(chan struct{})}
	gates <- gate
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- a.ConfirmTrustReview(ctx, review.ID) }()
	select {
	case <-gate.entered:
	case <-ctx.Done():
		t.Fatal("确认未进入第二次身份探测")
	}
	if err = a.RevokeTrust(record.Key); err != nil {
		t.Fatal(err)
	}
	close(gate.release)
	if err = <-done; err == nil {
		t.Fatal("撤销后晚到确认重新建立信任")
	}
	stored, err := a.store.Setting(record.Key)
	if err != nil || stored != "" || a.trusted[trustCacheKey(record)] != "" {
		t.Fatal("撤销后缓存或持久记录仍放行")
	}
}

func TestTrustNewProbeInvalidatesOlderProbeAndExpiry(t *testing.T) {
	a := testAppStore(t)
	record, _, gates := trustSSHServer(t)
	gate := &trustProbeGate{entered: make(chan struct{}), release: make(chan struct{})}
	gates <- gate
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := a.ProbeTrustReview(ctx, record.Key); done <- err }()
	select {
	case <-gate.entered:
	case <-ctx.Done():
		t.Fatal("探测未启动")
	}
	latest, err := a.ProbeTrustReview(ctx, record.Key)
	if err != nil {
		t.Fatal(err)
	}
	close(gate.release)
	if err = <-done; err == nil {
		t.Fatal("较早探测覆盖新代次")
	}
	a.mu.Lock()
	stored := a.trustReviews[latest.ID]
	stored.expires = time.Now().Add(-time.Second)
	a.trustReviews[latest.ID] = stored
	a.mu.Unlock()
	if err = a.ConfirmTrustReview(ctx, latest.ID); err == nil {
		t.Fatal("过期审核被放行")
	}
}

func TestTrustAuditCannotOverwriteChangedPersistentRecord(t *testing.T) {
	a := testAppStore(t)
	record, _, _ := trustSSHServer(t)
	review, err := a.ProbeTrustReview(t.Context(), record.Key)
	if err != nil {
		t.Fatal(err)
	}
	if err = a.store.SetSetting(record.Key, "changed-by-another-review"); err != nil {
		t.Fatal(err)
	}
	if err = a.ConfirmTrustReview(t.Context(), review.ID); err == nil {
		t.Fatal("审核覆盖已变化的持久记录")
	}
	stored, err := a.store.Setting(record.Key)
	if err != nil || stored != "changed-by-another-review" {
		t.Fatal("失败审核改写持久记录")
	}
}

func TestTrustPendingIdentityExpiryAndBound(t *testing.T) {
	a := testAppStore(t)
	a.mu.Lock()
	defer a.mu.Unlock()
	for i := 0; i < 128; i++ {
		if err := a.setPendingTrustLocked(fmt.Sprintf("host-%d:22", i), "test-fingerprint"); err != nil {
			t.Fatal(err)
		}
	}
	if err := a.setPendingTrustLocked("excess:22", "test-fingerprint"); err == nil {
		t.Fatal("待确认身份数量无界")
	}
	a.pendingTrustAt["host-0:22"] = time.Now().Add(-3 * time.Minute)
	if a.pendingTrustValidLocked("host-0:22", "test-fingerprint") {
		t.Fatal("过期待确认身份仍然有效")
	}
	if err := a.setPendingTrustLocked("replacement:22", "test-fingerprint"); err != nil {
		t.Fatal(err)
	}
	if len(a.pendingTrust) != 128 || len(a.pendingTrustAt) != 128 || len(a.pendingTrustGeneration) != 128 {
		t.Fatal("过期条目未同步清理")
	}
}

func TestTrustPaginationNamespacesAndPendingInvalidation(t *testing.T) {
	a := testAppStore(t)
	for i := 0; i < 257; i++ {
		key := fmt.Sprintf("trust:ssh:host-%03d.invalid:22", i)
		if err := a.store.SetSetting(key, "test-fingerprint"); err != nil {
			t.Fatal(err)
		}
	}
	page, err := a.ListTrusts("")
	if err != nil || len(page.Items) != 256 || page.Next == "" {
		t.Fatalf("信任首分页错误：%v", err)
	}
	next, err := a.ListTrusts(page.Next)
	if err != nil || len(next.Items) != 1 || next.Next != "" || next.Items[0].Key <= page.Next {
		t.Fatalf("信任分页遗漏或重复：%v", err)
	}
	for _, key := range []string{"ssh:host.invalid:22", "trust:rdp:via:jump:host.invalid:3389", "trust:ssh::22", "trust:ssh:host.invalid:0", "trust:other:host.invalid:22"} {
		if err := a.RevokeTrust(key); err == nil {
			t.Fatalf("接受无效信任键：%s", key)
		}
	}
	r, err := parseTrust("trust:ssh:via:jump:[::1]:22", "test-fingerprint")
	if err != nil || r.Host != "::1" || r.Via != "jump" {
		t.Fatal("IPv6 跳板信任解析错误")
	}
	cache := trustCacheKey(r)
	a.mu.Lock()
	err = a.setPendingTrustLocked(cache, r.Fingerprint)
	a.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	if err = a.RevokeTrust(r.Key); err != nil {
		t.Fatal(err)
	}
	if err = a.TrustSSHHost(r.Host, r.Port, r.Fingerprint, r.Via); err == nil {
		t.Fatal("撤销后旧首次确认仍然可用")
	}
	if _, exists := a.pendingTrustAt[cache]; exists {
		t.Fatal("撤销后残留待确认身份时间戳")
	}
}

func TestTrustRevokeRemovesUnusedRDPGrant(t *testing.T) {
	a := testAppStore(t)
	bridge, err := rdp.NewBridge([]string{"wails://localhost"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer bridge.Close()
	a.rdp = bridge
	grant, err := bridge.Create(rdp.Target{Host: "127.0.0.1", Port: 3389, Fingerprint: "test-fingerprint"})
	if err != nil {
		t.Fatal(err)
	}
	if err = a.RevokeTrust("trust:rdp:127.0.0.1:3389"); err != nil {
		t.Fatal(err)
	}
	assertRDPGrantRejected(t, grant)
}

func assertRDPGrantRejected(t *testing.T, grant rdp.Grant) {
	t.Helper()
	request, err := http.NewRequestWithContext(t.Context(), http.MethodGet, strings.Replace(grant.ProxyURL, "ws:", "http:", 1), nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Origin", "wails://localhost")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatal("未使用 RDP grant 撤销后仍可访问")
	}
}

func TestTrustRDPAuditInvalidatesUnusedOldIdentityGrant(t *testing.T) {
	certServer := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	certificate := certServer.TLS.Certificates[0]
	certServer.Close()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				conn.SetDeadline(time.Now().Add(5 * time.Second))
				packet := tpkt.NewConn(conn, slog.New(slog.NewTextHandler(io.Discard, nil)))
				if _, err := packet.Read(); err != nil {
					return
				}
				if err := packet.Write([]byte{14, 0xd0, 0, 0, 0, 0, 0, 2, 0, 8, 0, 2, 0, 0, 0}); err != nil {
					return
				}
				secured := tls.Server(conn, &tls.Config{Certificates: []tls.Certificate{certificate}, MinVersion: tls.VersionTLS12})
				if err := secured.Handshake(); err == nil {
					io.Copy(secured, secured)
				}
			}()
		}
	}()
	host, port, err := net.SplitHostPort(listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	number, err := strconv.Atoi(port)
	if err != nil {
		t.Fatal(err)
	}
	a := testAppStore(t)
	bridge, err := rdp.NewBridge([]string{"wails://localhost"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer bridge.Close()
	a.rdp = bridge
	key := "trust:rdp:" + listener.Addr().String()
	if err = a.store.SetSetting(key, "old-test-fingerprint"); err != nil {
		t.Fatal(err)
	}
	grant, err := bridge.Create(rdp.Target{Host: host, Port: number, Fingerprint: "old-test-fingerprint"})
	if err != nil {
		t.Fatal(err)
	}
	review, err := a.ProbeTrustReview(t.Context(), key)
	if err != nil || review.Old != "old-test-fingerprint" || review.New == "" {
		t.Fatalf("RDP 证书审核探测失败：%v", err)
	}
	if err = a.ConfirmTrustReview(t.Context(), review.ID); err != nil {
		t.Fatal(err)
	}
	assertRDPGrantRejected(t, grant)
}
