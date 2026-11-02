package rdp

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/asn1"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/bouncyball-git/gopher-rdp/protocol/tpkt"
	"github.com/bouncyball-git/gopher-rdp/protocol/x224"
	"github.com/coder/websocket"
)

func localRDPTLS(t *testing.T, expired ...bool) (Target, []byte) {
	t.Helper()
	certificateServer := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	certificate := certificateServer.TLS.Certificates[0]
	if len(expired) > 0 && expired[0] {
		template, err := x509.ParseCertificate(certificate.Certificate[0])
		if err != nil {
			t.Fatal(err)
		}
		template.NotBefore = time.Now().Add(-2 * time.Hour)
		template.NotAfter = time.Now().Add(-time.Hour)
		der, err := x509.CreateCertificate(rand.Reader, template, template, template.PublicKey, certificate.PrivateKey)
		if err != nil {
			t.Fatal(err)
		}
		certificate.Certificate[0] = der
		certificate.Leaf = nil
	}
	certificateServer.Close()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
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
				confirm := []byte{14, 0xd0, 0, 0, 0, 0, 0, 2, 0, 8, 0, 2, 0, 0, 0}
				if err := packet.Write(confirm); err != nil {
					return
				}
				secured := tls.Server(conn, &tls.Config{Certificates: []tls.Certificate{certificate}, MinVersion: tls.VersionTLS12})
				if err := secured.Handshake(); err != nil {
					return
				}
				io.Copy(secured, secured)
			}()
		}
	}()
	host, port, _ := net.SplitHostPort(listener.Addr().String())
	n, _ := strconv.Atoi(port)
	request := (&x224.ConnectionRequest{RequestedProtos: x224.ProtocolHybrid | x224.ProtocolHybridEx}).Encode()
	packet := append([]byte{3, 0, 0, byte(4 + len(request))}, request...)
	return Target{Host: host, Port: n, Fingerprint: fingerprint(certificate.Certificate[0])}, packet
}

func TestExpiredCertificateCannotBeTrusted(t *testing.T) {
	target, _ := localRDPTLS(t, true)
	if _, err := Probe(context.Background(), target); err == nil {
		t.Fatal("指纹匹配时接受过期证书")
	}
	target.Fingerprint = ""
	_, err := Probe(context.Background(), target)
	var cert *CertificateError
	if err == nil || errors.As(err, &cert) {
		t.Fatal("过期证书不应允许通过信任确认继续连接")
	}
}

func TestCertificateVerification(t *testing.T) {
	target, _ := localRDPTLS(t)
	expected := target.Fingerprint
	target.Fingerprint = ""
	_, err := Probe(context.Background(), target)
	var cert *CertificateError
	if !errors.As(err, &cert) || cert.Fingerprint != expected {
		t.Fatalf("未返回待确认的自签名证书: %v", err)
	}
	target.Fingerprint = expected
	actual, err := Probe(context.Background(), target)
	if err != nil || actual != expected {
		t.Fatalf("确认后的证书验证失败: %v", err)
	}
	target.Fingerprint = "SHA256:changed"
	if _, err = Probe(context.Background(), target); err == nil {
		t.Fatal("证书变更未阻止连接")
	}
}

func TestRDPUsesTLS12(t *testing.T) {
	target, request := localRDPTLS(t)
	conn, _, err := negotiate(context.Background(), target, request)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if conn.ConnectionState().Version != tls.VersionTLS12 {
		t.Fatal("RDP 桥接未使用已验证的 TLS 1.2")
	}
}

func TestCleanPathBridge(t *testing.T) {
	target, request := localRDPTLS(t)
	closed := make(chan error, 1)
	bridge, err := NewBridge([]string{"wails://localhost"}, func(_ string, err error) { closed <- err })
	if err != nil {
		t.Fatal(err)
	}
	defer bridge.Close()
	grant, err := bridge.Create(target)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	options := &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{"https://untrusted.invalid"}}}
	if c, _, err := websocket.Dial(ctx, grant.ProxyURL, options); err == nil {
		c.CloseNow()
		t.Fatal("接受未授权来源")
	}
	options.HTTPHeader.Set("Origin", "wails://localhost")
	ws, _, err := websocket.Dial(ctx, grant.ProxyURL, options)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()
	encoded, err := asn1.Marshal(cleanPathPDU{Version: cleanPathVersion, Destination: grant.Destination, ProxyAuth: grant.Token, X224: request})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(encoded, []byte{0xa0, 0x04, 0x02, 0x02, 0x0d, 0x3e}) {
		t.Fatal("RDCleanPath 显式版本标签不正确")
	}
	if err = ws.Write(ctx, websocket.MessageBinary, encoded); err != nil {
		t.Fatal(err)
	}
	_, raw, err := ws.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var response cleanPathPDU
	rest, err := asn1.Unmarshal(raw, &response)
	if err != nil || len(rest) != 0 || len(response.Certificates) != 1 || len(response.X224) == 0 || response.ServerAddress == "" {
		t.Fatalf("RDCleanPath 响应无效: %v", err)
	}
	if err = ws.Write(ctx, websocket.MessageBinary, []byte("tls-bridge-roundtrip")); err != nil {
		t.Fatal(err)
	}
	_, raw, err = ws.Read(ctx)
	if err != nil || string(raw) != "tls-bridge-roundtrip" {
		t.Fatalf("TLS 双向转发失败: %v", err)
	}
	if c, _, err := websocket.Dial(ctx, grant.ProxyURL, options); err == nil {
		c.CloseNow()
		t.Fatal("接受会话令牌重放")
	}
	bridge.CloseSession(grant.ID)
	if _, _, err = ws.Read(ctx); err == nil {
		t.Fatal("关闭会话未关闭传输")
	}
	select {
	case err := <-closed:
		if err != nil {
			t.Fatalf("正常关闭被报告为错误: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("没有报告连接关闭")
	}
}

func TestGrantBoundToTargetAndToken(t *testing.T) {
	target, request := localRDPTLS(t)
	bridge, err := NewBridge([]string{"wails://localhost"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer bridge.Close()
	for _, wrong := range []string{"token", "target"} {
		grant, err := bridge.Create(target)
		if err != nil {
			t.Fatal(err)
		}
		pdu := cleanPathPDU{Version: cleanPathVersion, Destination: grant.Destination, ProxyAuth: grant.Token, X224: request}
		if wrong == "token" {
			pdu.ProxyAuth = "wrong"
		} else {
			pdu.Destination = "127.0.0.1:1"
		}
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		ws, _, err := websocket.Dial(ctx, grant.ProxyURL, &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{"wails://localhost"}}})
		if err != nil {
			cancel()
			t.Fatal(err)
		}
		raw, _ := asn1.Marshal(pdu)
		ws.Write(ctx, websocket.MessageBinary, raw)
		if _, _, err = ws.Read(ctx); err == nil {
			t.Fatal("接受无效授权")
		}
		ws.CloseNow()
		cancel()
	}
}
