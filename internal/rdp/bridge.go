package rdp

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"encoding/asn1"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/bouncyball-git/gopher-rdp/protocol/tpkt"
	"github.com/bouncyball-git/gopher-rdp/protocol/x224"
	"github.com/coder/websocket"
)

const cleanPathVersion = 3390

type cleanPathError struct {
	Code       int `asn1:"explicit,tag:0"`
	HTTPStatus int `asn1:"optional,explicit,tag:1"`
}

type cleanPathPDU struct {
	Version           int           `asn1:"explicit,tag:0"`
	Error             asn1.RawValue `asn1:"optional,explicit,tag:1"`
	Destination       string        `asn1:"optional,explicit,tag:2,utf8"`
	ProxyAuth         string        `asn1:"optional,explicit,tag:3,utf8"`
	ServerAuth        string        `asn1:"optional,explicit,tag:4,utf8"`
	PreconnectionBlob string        `asn1:"optional,explicit,tag:5,utf8"`
	X224              []byte        `asn1:"optional,explicit,tag:6"`
	Certificates      [][]byte      `asn1:"optional,explicit,tag:7"`
	ServerAddress     string        `asn1:"optional,explicit,tag:9,utf8"`
}

type Target struct {
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Fingerprint string `json:"fingerprint"`
}

func (t Target) Address() string { return net.JoinHostPort(t.Host, strconv.Itoa(t.Port)) }
func (t Target) validate() error {
	if t.Host == "" || t.Port < 1 || t.Port > 65535 {
		return errors.New("RDP 地址或端口无效")
	}
	return nil
}

type CertificateError struct {
	Fingerprint string
	Reason      string
}

func (e *CertificateError) Error() string { return "RDP 证书需要确认: " + e.Reason }

type Grant struct {
	ID          string `json:"id"`
	ProxyURL    string `json:"proxy_url"`
	Token       string `json:"token"`
	Destination string `json:"destination"`
}

type authorization struct {
	target  Target
	token   string
	expires time.Time
	cancel  context.CancelFunc
	claimed bool
}

type Bridge struct {
	mu       sync.Mutex
	grants   map[string]*authorization
	server   *http.Server
	listener net.Listener
	ctx      context.Context
	cancel   context.CancelFunc
	origins  map[string]bool
	onError  func(string, string)
}

func NewBridge(origins []string, onError func(string, string)) (*Bridge, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	b := &Bridge{grants: map[string]*authorization{}, listener: listener, ctx: ctx, cancel: cancel, origins: map[string]bool{}, onError: onError}
	for _, origin := range origins {
		b.origins[origin] = true
	}
	b.server = &http.Server{Handler: http.HandlerFunc(b.serve), ReadHeaderTimeout: 5 * time.Second, MaxHeaderBytes: 8192}
	go func() {
		err := b.server.Serve(listener)
		if err != nil && !errors.Is(err, http.ErrServerClosed) && onError != nil {
			onError("", err.Error())
		}
	}()
	return b, nil
}

func (b *Bridge) Create(t Target) (Grant, error) {
	if err := t.validate(); err != nil {
		return Grant{}, err
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.ctx.Err() != nil {
		return Grant{}, errors.New("RDP 桥接已关闭")
	}
	for id, a := range b.grants {
		if !a.claimed && time.Now().After(a.expires) {
			delete(b.grants, id)
		}
	}
	if len(b.grants) >= 8 {
		return Grant{}, errors.New("当前最多运行 8 个 RDP 会话")
	}
	id, token := randomToken(), randomToken()
	b.grants[id] = &authorization{target: t, token: token, expires: time.Now().Add(time.Minute)}
	return Grant{ID: id, ProxyURL: "ws://" + b.listener.Addr().String() + "/rdp/" + id, Token: token, Destination: t.Address()}, nil
}

func (b *Bridge) CloseSession(id string) {
	b.mu.Lock()
	a := b.grants[id]
	delete(b.grants, id)
	b.mu.Unlock()
	if a != nil && a.cancel != nil {
		a.cancel()
	}
}
func (b *Bridge) Close() error {
	b.cancel()
	b.mu.Lock()
	for _, a := range b.grants {
		if a.cancel != nil {
			a.cancel()
		}
	}
	b.grants = map[string]*authorization{}
	b.mu.Unlock()
	return b.server.Close()
}

func (b *Bridge) serve(w http.ResponseWriter, r *http.Request) {
	if !b.origins[r.Header.Get("Origin")] {
		http.Error(w, "来源未授权", http.StatusForbidden)
		return
	}
	if !bytes.HasPrefix([]byte(r.URL.Path), []byte("/rdp/")) {
		http.NotFound(w, r)
		return
	}
	id := r.URL.Path[len("/rdp/"):]
	b.mu.Lock()
	a := b.grants[id]
	if a == nil || a.claimed || time.Now().After(a.expires) {
		b.mu.Unlock()
		http.Error(w, "会话未授权或已过期", http.StatusUnauthorized)
		return
	}
	ctx, cancel := context.WithCancel(b.ctx)
	a.claimed = true
	a.cancel = cancel
	b.mu.Unlock()
	defer cancel()
	defer b.CloseSession(id)
	origins := make([]string, 0, len(b.origins))
	for origin := range b.origins {
		origins = append(origins, origin)
	}
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: origins})
	if err != nil {
		return
	}
	defer ws.CloseNow()
	ws.SetReadLimit(1 << 20)
	if err = b.run(ctx, ws, a); err != nil {
		if b.onError != nil && ctx.Err() == nil {
			b.onError(id, err.Error())
		}
		ws.Close(websocket.StatusInternalError, "RDP 桥接失败")
	}
}

func (b *Bridge) run(ctx context.Context, ws *websocket.Conn, a *authorization) error {
	handshake, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	kind, raw, err := ws.Read(handshake)
	if err != nil {
		return err
	}
	if kind != websocket.MessageBinary {
		return errors.New("RDCleanPath 需要二进制消息")
	}
	var request cleanPathPDU
	rest, err := asn1.Unmarshal(raw, &request)
	if err != nil || len(rest) != 0 || request.Version != cleanPathVersion || len(request.X224) == 0 || request.Destination != a.target.Address() || request.PreconnectionBlob != "" || request.ServerAuth != "" || subtle.ConstantTimeCompare([]byte(request.ProxyAuth), []byte(a.token)) != 1 {
		return errors.New("RDCleanPath 授权或请求无效")
	}
	conn, response, err := negotiate(handshake, a.target, request.X224)
	if err != nil {
		return err
	}
	defer conn.Close()
	stop := context.AfterFunc(ctx, func() { conn.Close(); ws.CloseNow() })
	defer stop()
	state := conn.ConnectionState()
	chain := make([][]byte, len(state.PeerCertificates))
	for i, c := range state.PeerCertificates {
		chain[i] = c.Raw
	}
	responseDER, err := asn1.Marshal(cleanPathPDU{Version: cleanPathVersion, X224: response, Certificates: chain, ServerAddress: conn.RemoteAddr().String()})
	if err != nil {
		return err
	}
	if err = ws.Write(handshake, websocket.MessageBinary, responseDER); err != nil {
		return err
	}
	conn.SetDeadline(time.Time{})
	finished := make(chan error, 2)
	go func() {
		for {
			kind, data, err := ws.Read(ctx)
			if err != nil {
				finished <- err
				return
			}
			if kind != websocket.MessageBinary {
				finished <- errors.New("RDP 数据类型无效")
				return
			}
			if _, err = conn.Write(data); err != nil {
				finished <- err
				return
			}
		}
	}()
	go func() {
		buf := make([]byte, 32<<10)
		for {
			n, err := conn.Read(buf)
			if n > 0 {
				if err := ws.Write(ctx, websocket.MessageBinary, buf[:n]); err != nil {
					finished <- err
					return
				}
			}
			if err != nil {
				finished <- err
				return
			}
		}
	}()
	err = <-finished
	conn.Close()
	ws.CloseNow()
	<-finished
	if websocket.CloseStatus(err) == websocket.StatusNormalClosure || errors.Is(err, io.EOF) {
		return nil
	}
	return err
}

type recordingConn struct {
	net.Conn
	read bytes.Buffer
}

func (c *recordingConn) Read(b []byte) (int, error) {
	n, err := c.Conn.Read(b)
	c.read.Write(b[:n])
	return n, err
}

func negotiate(ctx context.Context, target Target, request []byte) (*tls.Conn, []byte, error) {
	if err := target.validate(); err != nil {
		return nil, nil, err
	}
	conn, err := (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, "tcp", target.Address())
	if err != nil {
		return nil, nil, err
	}
	ok := false
	defer func() {
		if !ok {
			conn.Close()
		}
	}()
	stop := context.AfterFunc(ctx, func() { conn.Close() })
	defer stop()
	conn.SetDeadline(time.Now().Add(15 * time.Second))
	if _, err = conn.Write(request); err != nil {
		return nil, nil, err
	}
	recorded := &recordingConn{Conn: conn}
	payload, err := tpkt.NewConn(recorded, slog.New(slog.NewTextHandler(io.Discard, nil))).Read()
	if err != nil {
		return nil, nil, err
	}
	confirm, err := x224.DecodeConnectionConfirm(slog.New(slog.NewTextHandler(io.Discard, nil)), payload)
	if err != nil {
		return nil, nil, err
	}
	if confirm.Type != x224.TypeRDPNegRsp || (confirm.SelectedProto != x224.ProtocolHybrid && confirm.SelectedProto != x224.ProtocolHybridEx) {
		return nil, nil, errors.New("RDP 目标未协商 TLS/NLA，已阻止安全协议降级")
	}
	config := &tls.Config{ServerName: target.Host, MinVersion: tls.VersionTLS12}
	if target.Fingerprint != "" {
		// 用户明确确认后，以精确证书指纹校验替代系统 CA 与主机名校验。
		config.InsecureSkipVerify = true
		config.VerifyConnection = func(state tls.ConnectionState) error {
			if len(state.PeerCertificates) == 0 || fingerprint(state.PeerCertificates[0].Raw) != target.Fingerprint {
				return errors.New("RDP 证书已变化，连接已阻止")
			}
			return nil
		}
	}
	secured := tls.Client(conn, config)
	if err = secured.HandshakeContext(ctx); err != nil {
		var verification *tls.CertificateVerificationError
		if errors.As(err, &verification) && len(verification.UnverifiedCertificates) > 0 {
			return nil, nil, &CertificateError{Fingerprint: fingerprint(verification.UnverifiedCertificates[0].Raw), Reason: verification.Err.Error()}
		}
		return nil, nil, err
	}
	if ctx.Err() != nil {
		return nil, nil, ctx.Err()
	}
	ok = true
	return secured, recorded.read.Bytes(), nil
}

func Probe(ctx context.Context, target Target) (string, error) {
	request := (&x224.ConnectionRequest{RequestedProtos: x224.ProtocolHybrid | x224.ProtocolHybridEx}).Encode()
	packet := make([]byte, 4+len(request))
	packet[0] = 3
	packet[2] = byte(len(packet) >> 8)
	packet[3] = byte(len(packet))
	copy(packet[4:], request)
	conn, _, err := negotiate(ctx, target, packet)
	if err != nil {
		return "", err
	}
	defer conn.Close()
	return fingerprint(conn.ConnectionState().PeerCertificates[0].Raw), nil
}

func fingerprint(raw []byte) string {
	sum := sha256.Sum256(raw)
	return "SHA256:" + hex.EncodeToString(sum[:])
}
func randomToken() string {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(fmt.Errorf("随机数生成失败: %w", err))
	}
	return base64.RawURLEncoding.EncodeToString(b[:])
}
