package ssh

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	gossh "golang.org/x/crypto/ssh"
)

func localServer(t *testing.T) (Request, <-chan string) {
	t.Helper()
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	signer, _ := gossh.NewSignerFromKey(key)
	config := &gossh.ServerConfig{PasswordCallback: func(_ gossh.ConnMetadata, password []byte) (*gossh.Permissions, error) {
		if string(password) != "local-test" {
			return nil, errors.New("认证失败")
		}
		return nil, nil
	}}
	config.AddHostKey(signer)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	inputs := make(chan string, 8)
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				server, channels, requests, err := gossh.NewServerConn(conn, config)
				if err != nil {
					conn.Close()
					return
				}
				defer server.Close()
				go gossh.DiscardRequests(requests)
				for channel := range channels {
					c, reqs, err := channel.Accept()
					if err != nil {
						return
					}
					go func() {
						defer c.Close()
						for req := range reqs {
							switch req.Type {
							case "pty-req", "window-change":
								req.Reply(true, nil)
							case "shell":
								req.Reply(true, nil)
								go func() {
									scanner := bufio.NewScanner(c)
									for scanner.Scan() {
										line := scanner.Text()
										inputs <- line
										if line == "burst" {
											go func() { io.Copy(c, bytes.NewReader(bytes.Repeat([]byte("x"), 4<<20))) }()
										} else {
											io.WriteString(c, line+"\n")
										}
									}
								}()
							case "subsystem":
								req.Reply(true, nil)
							default:
								req.Reply(false, nil)
							}
						}
					}()
				}
			}()
		}
	}()
	host, port, _ := net.SplitHostPort(listener.Addr().String())
	n, _ := strconv.Atoi(port)
	return Request{Host: host, Port: n, Username: "test", Password: "local-test", Fingerprint: gossh.FingerprintSHA256(signer.PublicKey()), Cols: 80, Rows: 24}, inputs
}

func TestSFTPInitializationCancellationPreservesPTY(t *testing.T) {
	r, _ := localServer(t)
	terminal, err := Dial(context.Background(), r)
	if err != nil {
		t.Fatal(err)
	}
	defer terminal.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := terminal.FileClient(ctx); done <- err }()
	select {
	case err := <-done:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("SFTP 初始化没有按上下文取消: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("取消没有中断 SFTP 初始化")
	}
	if err = terminal.Resize(90, 30); err != nil {
		t.Fatal("取消 SFTP 中断了交互 PTY")
	}
}

type testStream struct {
	ctx    context.Context
	cancel context.CancelFunc
	in     chan []byte
	out    chan []byte
	once   sync.Once
}

func newStream() *testStream {
	ctx, cancel := context.WithCancel(context.Background())
	return &testStream{ctx: ctx, cancel: cancel, in: make(chan []byte, 8), out: make(chan []byte, 8)}
}
func (s *testStream) Context() context.Context { return s.ctx }
func (s *testStream) Close() error             { s.once.Do(s.cancel); return nil }
func (s *testStream) Send(b []byte) error {
	select {
	case s.out <- b:
		return nil
	case <-s.ctx.Done():
		return s.ctx.Err()
	}
}
func (s *testStream) Receive() ([]byte, error) {
	select {
	case b := <-s.in:
		return b, nil
	case <-s.ctx.Done():
		return nil, s.ctx.Err()
	}
}

func TestHostIdentityAndAuthentication(t *testing.T) {
	r, _ := localServer(t)
	r.Fingerprint = ""
	_, err := Dial(context.Background(), r)
	var identity *HostKeyError
	if !errors.As(err, &identity) {
		t.Fatalf("未拒绝未确认身份: %v", err)
	}
	r.Fingerprint = identity.Fingerprint
	r.Password = "wrong"
	if terminal, err := Dial(context.Background(), r); err == nil {
		terminal.Close()
		t.Fatal("接受错误密码")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if terminal, err := Dial(ctx, r); err == nil {
		terminal.Close()
		t.Fatal("忽略连接取消")
	}
}

func TestRelayBackpressureInputAndClose(t *testing.T) {
	r, inputs := localServer(t)
	terminal, err := Dial(context.Background(), r)
	if err != nil {
		t.Fatal(err)
	}
	defer terminal.Close()
	s := newStream()
	defer s.Close()
	done := make(chan error, 1)
	go func() { done <- Relay(terminal, s) }()
	s.in <- append([]byte{0}, []byte("burst\n")...)
	select {
	case <-inputs:
	case <-time.After(time.Second):
		t.Fatal("未收到输入")
	}
	var first []byte
	select {
	case first = <-s.out:
	case <-time.After(time.Second):
		t.Fatal("没有输出")
	}
	if len(first) > ChunkSize {
		t.Fatal("输出超过帧限制")
	}
	select {
	case <-s.out:
		t.Fatal("未确认消费即继续输出")
	case <-time.After(100 * time.Millisecond):
	}
	s.in <- append([]byte{0}, []byte("responsive\n")...)
	select {
	case line := <-inputs:
		if line != "responsive" {
			t.Fatal("输入内容错误")
		}
	case <-time.After(time.Second):
		t.Fatal("背压阻止了输入")
	}
	if err = terminal.Resize(120, 40); err != nil {
		t.Fatal(err)
	}
	ack := make([]byte, 5)
	ack[0] = 1
	binary.BigEndian.PutUint32(ack[1:], uint32(len(first)))
	s.in <- ack
	select {
	case <-s.out:
	case <-time.After(time.Second):
		t.Fatal("消费确认未恢复输出")
	}
	s.Close()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("关闭未释放 Relay")
	}
	select {
	case <-terminal.Done:
	case <-time.After(time.Second):
		t.Fatal("关闭未释放 SSH session")
	}
}

func TestSG1PTY(t *testing.T) {
	if os.Getenv("SSH_MCP_SERVER_SG1_PASSWORD") == "" {
		t.Skip("未注入真实 SSH 测试凭据")
	}
	port, err := strconv.Atoi(os.Getenv("SSH_MCP_SERVER_SG1_PORT"))
	if err != nil {
		t.Fatal("测试端口无效")
	}
	r := Request{Host: os.Getenv("SSH_MCP_SERVER_SG1_HOST"), Port: port, Username: os.Getenv("SSH_MCP_SERVER_SG1_USERNAME"), Password: os.Getenv("SSH_MCP_SERVER_SG1_PASSWORD"), Fingerprint: os.Getenv("TERMQUAY_TEST_HOST_FINGERPRINT"), Cols: 80, Rows: 24}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	terminal, err := Dial(ctx, r)
	if err != nil {
		t.Fatalf("真实 SSH PTY 建立失败: %v", err)
	}
	defer terminal.Close()
	stop := context.AfterFunc(ctx, terminal.Close)
	defer stop()
	if err = terminal.Resize(120, 40); err != nil {
		t.Fatal(err)
	}
	if _, err = io.WriteString(terminal.Input, "printf '__TERMQUAY_%s__\\n' PTY_OK; stty size\n"); err != nil {
		t.Fatal(err)
	}
	var output strings.Builder
	buf := make([]byte, 4096)
	for {
		n, err := terminal.Output.Read(buf)
		output.Write(buf[:n])
		text := output.String()
		if strings.Contains(text, "__TERMQUAY_PTY_OK__") && strings.Contains(text, "40 120") {
			break
		}
		if err != nil {
			t.Fatal("真实 SSH 输出或尺寸验证失败")
		}
	}
	t.Log("真实 SSH PTY 输入、输出、尺寸变化通过")
}

func TestIndependentPTYAndWorkspaceClose(t *testing.T) {
	r, _ := localServer(t)
	owner, err := Dial(context.Background(), r)
	if err != nil {
		t.Fatal(err)
	}
	owner.KeepConnection()
	defer owner.Disconnect()
	sibling, err := owner.OpenPTY(80, 24)
	if err != nil {
		t.Fatal(err)
	}
	defer sibling.Close()
	owner.Close()
	if _, err = io.WriteString(sibling.Input, "independent\n"); err != nil {
		t.Fatal("关闭其他 PTY 导致当前输入失败")
	}
	buf := make([]byte, 100)
	n, err := sibling.Output.Read(buf)
	if err != nil || !strings.Contains(string(buf[:n]), "independent") {
		t.Fatal("PTY 没有独立运行")
	}
	owner.Disconnect()
	select {
	case <-sibling.Done:
	case <-time.After(time.Second):
		t.Fatal("工作区关闭没有释放子 PTY")
	}
}

func TestPTYLifecycle100Cycles(t *testing.T) {
	r, _ := localServer(t)
	owner, err := Dial(context.Background(), r)
	if err != nil {
		t.Fatal(err)
	}
	owner.KeepConnection()
	defer owner.Disconnect()
	before := runtime.NumGoroutine()
	for range 100 {
		child, err := owner.OpenPTY(80, 24)
		if err != nil {
			t.Fatal(err)
		}
		child.Close()
		select {
		case <-child.Done:
		case <-time.After(time.Second):
			t.Fatal("PTY 关闭没有结束等待任务")
		}
	}
	deadline := time.Now().Add(2 * time.Second)
	for runtime.NumGoroutine() > before+4 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	after := runtime.NumGoroutine()
	t.Logf("100 次本地 PTY 创建关闭，goroutine %d → %d", before, after)
	if after > before+4 {
		t.Fatal("PTY 关闭后 goroutine 未回收")
	}
}

func TestRelayPreservesFourMiB(t *testing.T) {
	r, _ := localServer(t)
	terminal, err := Dial(context.Background(), r)
	if err != nil {
		t.Fatal(err)
	}
	defer terminal.Close()
	stream := newStream()
	defer stream.Close()
	done := make(chan error, 1)
	go func() { done <- Relay(terminal, stream) }()
	stream.in <- append([]byte{0}, []byte("burst\n")...)
	total := 0
	for total < 4<<20 {
		select {
		case frame := <-stream.out:
			for _, b := range frame {
				if b != 'x' {
					t.Fatal("协议字节被修改")
				}
			}
			total += len(frame)
			ack := make([]byte, 5)
			ack[0] = 1
			binary.BigEndian.PutUint32(ack[1:], uint32(len(frame)))
			stream.in <- ack
		case <-time.After(5 * time.Second):
			t.Fatal("终端字节丢失或背压停滞")
		}
	}
	if total != 4<<20 {
		t.Fatal("终端字节数不一致")
	}
	stream.Close()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("转发任务未关闭")
	}
}
