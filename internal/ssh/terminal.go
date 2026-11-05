package ssh

import (
	"context"
	"crypto/subtle"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"sync"
	"time"

	gossh "golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
)

const ChunkSize = 32 << 10

type Request struct {
	ConnectionID    string `json:"connection_id,omitempty"`
	Host            string `json:"host"`
	Port            int    `json:"port"`
	Username        string `json:"username"`
	Password        string `json:"password"`
	PrivateKey      string `json:"private_key"`
	Passphrase      string `json:"passphrase"`
	Fingerprint     string `json:"fingerprint"`
	Cols            int    `json:"cols"`
	Rows            int    `json:"rows"`
	AuthMethod      string `json:"auth_method,omitempty"`
	IdentityAgent   string `json:"identity_agent,omitempty"`
	PrivateKeyToken string `json:"private_key_token,omitempty"`
	JumpID          string `json:"jump_id,omitempty"`
	AuthID          string `json:"auth_id,omitempty"`
	MFA             bool   `json:"mfa,omitempty"`
	Certificate     string `json:"certificate,omitempty"`
	ProxyAddress    string `json:"proxy_address,omitempty"`
	challenge       gossh.KeyboardInteractiveChallenge
	progress        func(string) func(error)
}

func WithChallenge(r Request, challenge gossh.KeyboardInteractiveChallenge) Request {
	if challenge != nil {
		r.challenge = func(_ string, instruction string, questions []string, echo []bool) ([]string, error) {
			return challenge(r.Username+"@"+net.JoinHostPort(r.Host, strconv.Itoa(r.Port)), instruction, questions, echo)
		}
	}
	return r
}

type HostKeyError struct {
	Fingerprint string
	Host        string
	Port        int
	Jump        bool
	Via         string
}

func (e *HostKeyError) Error() string { return "SSH 主机身份尚未确认或已变化" }

type Terminal struct {
	client           *gossh.Client
	jumps            []*gossh.Client
	forwardSlots     chan struct{}
	forwardRequests  chan struct{}
	probeSlots       chan struct{}
	commandRequests  chan struct{}
	session          *gossh.Session
	Input            io.WriteCloser
	Output           *io.PipeReader
	writer           *io.PipeWriter
	once             sync.Once
	Done             chan struct{}
	mu               sync.Mutex
	waitErr          error
	logMu            sync.Mutex
	log              *terminalLog
	logClosed        bool
	logCols, logRows int
	completionLog    completionLogFilter
	connectionOwner  bool
}

func Dial(ctx context.Context, r Request) (*Terminal, error) {
	if r.JumpID != "" {
		return nil, errors.New("跳板请求必须由工作区解析")
	}
	client, err := dialClient(ctx, r, func(ctx context.Context, address string) (net.Conn, error) {
		return connectDirect(ctx, r, address)
	})
	if err != nil {
		return nil, err
	}
	return terminalOn(ctx, client, r)
}
func terminalOn(ctx context.Context, client *gossh.Client, r Request) (result *Terminal, failure error) {
	finish := r.connectionStage("终端通道与 Shell")
	defer func() { finish(failure) }()
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	stop := context.AfterFunc(ctx, func() { client.Close() })
	t, err := newTerminal(client, r.Cols, r.Rows)
	if err != nil {
		stop()
		client.Close()
		return nil, err
	}
	t.connectionOwner = true
	if !stop() && ctx.Err() != nil {
		t.Close()
		return nil, ctx.Err()
	}
	return t, nil
}
func dialClient(ctx context.Context, r Request, connect func(context.Context, string) (net.Conn, error)) (result *gossh.Client, failure error) {
	if r.Host == "" || r.Username == "" || r.Port < 1 || r.Port > 65535 || r.Cols < 1 || r.Rows < 1 {
		return nil, errors.New("SSH 地址、用户名、端口或终端尺寸无效")
	}
	authTimeout := 20 * time.Second
	if r.MFA || r.AuthMethod == "keyboard_interactive" {
		authTimeout = 3 * time.Minute
	}
	ctx, cancel := context.WithTimeout(ctx, authTimeout)
	defer cancel()
	var auth []gossh.AuthMethod
	method := r.AuthMethod
	if method == "" {
		if r.PrivateKey != "" {
			method = "private_key"
		} else {
			method = "password"
		}
	}
	finishCredentials := r.connectionStage("认证材料")
	credentialsReady := false
	defer func() {
		if !credentialsReady {
			finishCredentials(failure)
		}
	}()
	if method == "agent" {
		if r.IdentityAgent == "none" {
			return nil, errors.New("此连接已禁用 SSH Agent")
		}
		socket, err := dialAgent(ctx, r.IdentityAgent)
		if err != nil {
			return nil, fmt.Errorf("SSH Agent 不可用: %w", err)
		}
		defer socket.Close()
		stopAgent := context.AfterFunc(ctx, func() { socket.Close() })
		defer stopAgent()
		socket.SetDeadline(time.Now().Add(20 * time.Second))
		signers, err := agent.NewClient(socket).Signers()
		if err != nil {
			return nil, fmt.Errorf("读取 Agent 密钥失败: %w", err)
		}
		if len(signers) == 0 || len(signers) > 32 {
			return nil, errors.New("SSH Agent 密钥为空或超过 32 个")
		}
		auth = append(auth, gossh.PublicKeys(signers...))
	} else if method == "private_key" {
		var signer gossh.Signer
		var err error
		if r.Passphrase != "" {
			signer, err = gossh.ParsePrivateKeyWithPassphrase([]byte(r.PrivateKey), []byte(r.Passphrase))
		} else {
			signer, err = gossh.ParsePrivateKey([]byte(r.PrivateKey))
		}
		if err != nil {
			return nil, fmt.Errorf("私钥解析失败: %w", err)
		}
		if r.Certificate != "" {
			key, _, _, rest, err := gossh.ParseAuthorizedKey([]byte(r.Certificate))
			if err != nil || len(rest) != 0 {
				return nil, errors.New("SSH 用户证书格式无效")
			}
			certificate, ok := key.(*gossh.Certificate)
			if !ok || certificate.CertType != gossh.UserCert {
				return nil, errors.New("需要 SSH 用户证书")
			}
			now := uint64(time.Now().Unix())
			if now < certificate.ValidAfter || now >= certificate.ValidBefore {
				return nil, errors.New("SSH 用户证书已过期或尚未生效")
			}
			signer, err = gossh.NewCertSigner(certificate, signer)
			if err != nil {
				return nil, fmt.Errorf("SSH 用户证书与私钥不匹配：%w", err)
			}
		}
		auth = append(auth, gossh.PublicKeys(signer))
	} else if method == "password" {
		auth = append(auth, gossh.Password(r.Password))
	} else if method != "keyboard_interactive" {
		return nil, errors.New("SSH 认证方式无效")
	}
	if method == "keyboard_interactive" || r.MFA {
		if r.challenge == nil {
			return nil, errors.New("交互认证需要从连接窗口发起")
		}
		auth = append(auth, gossh.KeyboardInteractive(r.challenge))
	}
	finishCredentials(nil)
	credentialsReady = true
	var finishHandshake, finishAuth func(error)
	var identityOnce sync.Once
	config := &gossh.ClientConfig{User: r.Username, Auth: auth,
		HostKeyAlgorithms: []string{gossh.KeyAlgoED25519, gossh.KeyAlgoECDSA256, gossh.KeyAlgoECDSA384, gossh.KeyAlgoECDSA521, gossh.KeyAlgoRSASHA512, gossh.KeyAlgoRSASHA256},
		HostKeyCallback: func(_ string, _ net.Addr, key gossh.PublicKey) error {
			fingerprint := gossh.FingerprintSHA256(key)
			var identityError error
			if subtle.ConstantTimeCompare([]byte(fingerprint), []byte(r.Fingerprint)) != 1 {
				identityError = &HostKeyError{Fingerprint: fingerprint, Host: r.Host, Port: r.Port, Via: r.JumpID}
			}
			identityOnce.Do(func() {
				finishHandshake(nil)
				finishHandshake = nil
				r.connectionStage("主机身份校验")(identityError)
				if identityError == nil {
					finishAuth = r.connectionStage("SSH 用户认证")
				}
			})
			return identityError
		}}
	address := net.JoinHostPort(r.Host, strconv.Itoa(r.Port))
	stage := "TCP 建连（含 DNS）"
	if r.ProxyAddress != "" {
		stage = "SOCKS5 路径连接"
	} else if r.JumpID != "" {
		stage = "跳板转发目标端口"
	}
	finishConnect := r.connectionStage(stage)
	conn, err := connect(ctx, address)
	finishConnect(err)
	if err != nil {
		stage := "TCP 连接"
		if r.ProxyAddress != "" {
			stage = "SOCKS5 代理连接"
		}
		var dns *net.DNSError
		if errors.As(err, &dns) {
			stage = "DNS 解析"
		}
		return nil, &ConnectionError{Stage: stage, Err: err, Retryable: ctx.Err() == nil}
	}
	stop := context.AfterFunc(ctx, func() { conn.Close() })
	finishHandshake = r.connectionStage("SSH 协商")
	c, chans, reqs, err := gossh.NewClientConn(conn, address, config)
	if finishHandshake != nil {
		finishHandshake(err)
	}
	if finishAuth != nil {
		finishAuth(err)
	}
	if err != nil {
		stop()
		conn.Close()
		var identity *HostKeyError
		if errors.As(err, &identity) {
			return nil, err
		}
		return nil, &ConnectionError{Stage: "SSH 协商与认证", Err: err}
	}
	client := gossh.NewClient(c, chans, reqs)
	if !stop() && ctx.Err() != nil {
		client.Close()
		return nil, ctx.Err()
	}
	go keepAlive(client)
	return client, nil
}

func newTerminal(client *gossh.Client, cols, rows int) (*Terminal, error) {
	return newTerminalCommand(client, cols, rows, "")
}

func newTerminalCommand(client *gossh.Client, cols, rows int, command string) (*Terminal, error) {
	s, err := client.NewSession()
	if err != nil {
		return nil, err
	}
	fail := func(err error) (*Terminal, error) { s.Close(); return nil, err }
	input, err := s.StdinPipe()
	if err != nil {
		return fail(err)
	}
	reader, writer := io.Pipe()
	s.Stdout = writer
	s.Stderr = writer
	if err = s.RequestPty("xterm-256color", rows, cols, gossh.TerminalModes{gossh.ECHO: 1, gossh.TTY_OP_ISPEED: 38400, gossh.TTY_OP_OSPEED: 38400}); err != nil {
		reader.Close()
		writer.Close()
		return fail(err)
	}
	if command == "" {
		err = s.Shell()
	} else {
		err = s.Start(command)
	}
	if err != nil {
		reader.Close()
		writer.Close()
		return fail(err)
	}
	t := &Terminal{client: client, session: s, Input: input, Output: reader, writer: writer, Done: make(chan struct{}), forwardSlots: make(chan struct{}, 8), forwardRequests: make(chan struct{}, 4), probeSlots: make(chan struct{}, 4), logCols: cols, logRows: rows}
	go func() {
		err := s.Wait()
		t.mu.Lock()
		t.waitErr = err
		t.mu.Unlock()
		writer.Close()
		close(t.Done)
	}()
	return t, nil
}

func (t *Terminal) Resize(cols, rows int) error {
	if cols < 1 || rows < 1 || cols > 1000 || rows > 1000 {
		return errors.New("终端尺寸无效")
	}
	if err := t.session.WindowChange(rows, cols); err != nil {
		return err
	}
	t.recordResize(cols, rows)
	return nil
}

func (t *Terminal) Close() {
	t.once.Do(func() {
		if t.connectionOwner {
			t.client.Close()
			for _, jump := range t.jumps {
				jump.Close()
			}
		}
		t.Input.Close()
		t.Output.Close()
		t.writer.Close()
		t.session.Close()
		t.closeLog()
		if t.connectionOwner {
			t.client.Close()
			for _, jump := range t.jumps {
				jump.Close()
			}
		}
	})
}

func (t *Terminal) KeepConnection() { t.connectionOwner = false }

func (t *Terminal) WaitConnection() error { return t.client.Wait() }
func (t *Terminal) Disconnect() {
	t.client.Close()
	for _, jump := range t.jumps {
		jump.Close()
	}
	t.Close()
}
func (t *Terminal) OpenPTY(cols, rows int) (*Terminal, error) {
	if cols < 1 || cols > 1000 || rows < 1 || rows > 1000 {
		return nil, errors.New("终端尺寸无效")
	}
	return newTerminal(t.client, cols, rows)
}

func (t *Terminal) OpenTmuxPTY(sessionID string) (*Terminal, error) {
	if len(sessionID) < 2 || len(sessionID) > 32 || sessionID[0] != '$' {
		return nil, errors.New("tmux 会话标识无效")
	}
	for _, digit := range sessionID[1:] {
		if digit < '0' || digit > '9' {
			return nil, errors.New("tmux 会话标识无效")
		}
	}
	return newTerminalCommand(t.client, 100, 30, "tmux attach-session -t '"+sessionID+"'")
}

func (t *Terminal) WaitError() error { t.mu.Lock(); defer t.mu.Unlock(); return t.waitErr }

type Stream interface {
	Context() context.Context
	Send([]byte) error
	Receive() ([]byte, error)
	Close() error
}

func Relay(t *Terminal, s Stream, inputAllowed ...func() bool) error {
	return RelayIO(t.Input, t.Output, t.Done, t.Close, t.WaitError, t.recordOutput, s, inputAllowed...)
}

func RelayIO(input io.Writer, output io.Reader, done <-chan struct{}, closeEndpoint func(), waitError func() error, record func([]byte), s Stream, inputAllowed ...func() bool) error {
	defer closeEndpoint()
	defer s.Close()
	ctx, cancel := context.WithCancel(s.Context())
	defer cancel()
	stop := context.AfterFunc(ctx, closeEndpoint)
	defer stop()
	acks := make(chan uint32, 1)
	received := make(chan error, 1)
	go func() {
		defer cancel()
		for {
			frame, err := s.Receive()
			if err != nil {
				received <- err
				return
			}
			if len(frame) == 0 || len(frame) > ChunkSize+1 {
				received <- errors.New("终端输入帧无效")
				return
			}
			switch frame[0] {
			case 0:
				if len(inputAllowed) > 0 && !inputAllowed[0]() {
					continue
				}
				if _, err = input.Write(frame[1:]); err != nil {
					received <- err
					return
				}
			case 1:
				if len(frame) != 5 {
					received <- errors.New("终端消费确认无效")
					return
				}
				select {
				case acks <- binary.BigEndian.Uint32(frame[1:]):
				case <-s.Context().Done():
					return
				default:
					received <- errors.New("重复终端消费确认")
					return
				}
			default:
				received <- errors.New("未知终端输入类型")
				return
			}
		}
	}()
	// 等待 xterm.js 解析确认后再读下一帧，避免积压转移到前端解析队列。
	buf := make([]byte, ChunkSize)
	for {
		n, err := output.Read(buf)
		if n > 0 {
			if record != nil {
				record(buf[:n])
			}
			if sendErr := s.Send(buf[:n]); sendErr != nil {
				return sendErr
			}
			select {
			case count := <-acks:
				if count != uint32(n) {
					return errors.New("终端消费确认字节数不匹配")
				}
			case err := <-received:
				return err
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		if err != nil {
			if errors.Is(err, io.EOF) {
				select {
				case <-done:
					return waitError()
				case <-ctx.Done():
					return ctx.Err()
				}
			}
			return err
		}
	}
}
