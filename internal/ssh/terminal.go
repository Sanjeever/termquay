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
)

const ChunkSize = 32 << 10

type Request struct {
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Username    string `json:"username"`
	Password    string `json:"password"`
	PrivateKey  string `json:"private_key"`
	Passphrase  string `json:"passphrase"`
	Fingerprint string `json:"fingerprint"`
	Cols        int    `json:"cols"`
	Rows        int    `json:"rows"`
}

type HostKeyError struct{ Fingerprint string }

func (e *HostKeyError) Error() string { return "SSH 主机身份尚未确认或已变化" }

type Terminal struct {
	client  *gossh.Client
	session *gossh.Session
	Input   io.WriteCloser
	Output  *io.PipeReader
	writer  *io.PipeWriter
	once    sync.Once
	Done    chan struct{}
	mu      sync.Mutex
	waitErr error
}

func Dial(ctx context.Context, r Request) (*Terminal, error) {
	if r.Host == "" || r.Username == "" || r.Port < 1 || r.Port > 65535 || r.Cols < 1 || r.Rows < 1 {
		return nil, errors.New("SSH 地址、用户名、端口或终端尺寸无效")
	}
	var auth []gossh.AuthMethod
	if r.PrivateKey != "" {
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
		auth = append(auth, gossh.PublicKeys(signer))
	} else {
		auth = append(auth, gossh.Password(r.Password))
	}
	config := &gossh.ClientConfig{User: r.Username, Auth: auth,
		HostKeyAlgorithms: []string{gossh.KeyAlgoED25519, gossh.KeyAlgoECDSA256, gossh.KeyAlgoECDSA384, gossh.KeyAlgoECDSA521, gossh.KeyAlgoRSASHA512, gossh.KeyAlgoRSASHA256},
		HostKeyCallback: func(_ string, _ net.Addr, key gossh.PublicKey) error {
			fingerprint := gossh.FingerprintSHA256(key)
			if subtle.ConstantTimeCompare([]byte(fingerprint), []byte(r.Fingerprint)) != 1 {
				return &HostKeyError{Fingerprint: fingerprint}
			}
			return nil
		}}
	address := net.JoinHostPort(r.Host, strconv.Itoa(r.Port))
	conn, err := (&net.Dialer{Timeout: 15 * time.Second}).DialContext(ctx, "tcp", address)
	if err != nil {
		return nil, err
	}
	stop := context.AfterFunc(ctx, func() { conn.Close() })
	conn.SetDeadline(time.Now().Add(20 * time.Second))
	c, chans, reqs, err := gossh.NewClientConn(conn, address, config)
	if err != nil {
		stop()
		conn.Close()
		return nil, err
	}
	client := gossh.NewClient(c, chans, reqs)
	s, err := client.NewSession()
	if err != nil {
		stop()
		client.Close()
		return nil, err
	}
	fail := func(err error) (*Terminal, error) { stop(); s.Close(); client.Close(); return nil, err }
	input, err := s.StdinPipe()
	if err != nil {
		return fail(err)
	}
	reader, writer := io.Pipe()
	s.Stdout = writer
	s.Stderr = writer
	if err = s.RequestPty("xterm-256color", r.Rows, r.Cols, gossh.TerminalModes{gossh.ECHO: 1, gossh.TTY_OP_ISPEED: 38400, gossh.TTY_OP_OSPEED: 38400}); err != nil {
		reader.Close()
		writer.Close()
		return fail(err)
	}
	if err = s.Shell(); err != nil {
		reader.Close()
		writer.Close()
		return fail(err)
	}
	if !stop() && ctx.Err() != nil {
		reader.Close()
		writer.Close()
		return fail(ctx.Err())
	}
	if err = conn.SetDeadline(time.Time{}); err != nil {
		reader.Close()
		writer.Close()
		return fail(err)
	}
	t := &Terminal{client: client, session: s, Input: input, Output: reader, writer: writer, Done: make(chan struct{})}
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
	return t.session.WindowChange(rows, cols)
}

func (t *Terminal) Close() {
	t.once.Do(func() { t.Input.Close(); t.Output.Close(); t.writer.Close(); t.client.Close() })
}

func (t *Terminal) WaitError() error { t.mu.Lock(); defer t.mu.Unlock(); return t.waitErr }

type Stream interface {
	Context() context.Context
	Send([]byte) error
	Receive() ([]byte, error)
	Close() error
}

func Relay(t *Terminal, s Stream) error {
	defer t.Close()
	defer s.Close()
	ctx, cancel := context.WithCancel(s.Context())
	defer cancel()
	stop := context.AfterFunc(ctx, t.Close)
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
				if _, err = t.Input.Write(frame[1:]); err != nil {
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
	// 每次至多一个 32 KiB 输出帧等待 xterm.js 解析确认。
	for {
		buf := make([]byte, ChunkSize)
		n, err := t.Output.Read(buf)
		if n > 0 {
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
				return nil
			}
			return err
		}
	}
}
