package app

import (
	"context"
	"encoding/binary"
	"encoding/pem"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	terminal "github.com/Sanjeever/termquay/internal/ssh"
	gossh "golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
)

func TestSG1WorkflowEncryptedKeyAndAgent(t *testing.T) {
	r := sg1WorkflowRequest(t)
	key, err := gossh.ParseRawPrivateKey([]byte(r.PrivateKey))
	if err != nil {
		t.Fatal("解析测试私钥失败")
	}
	t.Run("加密私钥", func(t *testing.T) {
		block, err := gossh.MarshalPrivateKeyWithPassphrase(key, "termquay-test", []byte("ephemeral-test-passphrase"))
		if err != nil {
			t.Fatal(err)
		}
		request := r
		request.PrivateKey = string(pem.EncodeToMemory(block))
		request.Passphrase = "ephemeral-test-passphrase"
		connection, err := terminal.Dial(t.Context(), request)
		if err != nil {
			t.Fatal(err)
		}
		connection.Close()
		request.Passphrase = "incorrect-test-passphrase"
		if connection, err = terminal.Dial(t.Context(), request); err == nil {
			connection.Close()
			t.Fatal("接受错误私钥口令")
		}
	})
	t.Run("独立Agent连接真实服务器", func(t *testing.T) {
		directory, err := os.MkdirTemp("/tmp", "termquay-agent-")
		if err != nil {
			t.Fatal(err)
		}
		defer os.RemoveAll(directory)
		listener, err := net.Listen("unix", filepath.Join(directory, "agent.sock"))
		if err != nil {
			t.Fatal(err)
		}
		defer listener.Close()
		keyring := agent.NewKeyring()
		if err := keyring.Add(agent.AddedKey{PrivateKey: key}); err != nil {
			t.Fatal("载入测试 Agent 失败")
		}
		served := make(chan error, 1)
		go func() {
			conn, err := listener.Accept()
			if err != nil {
				served <- err
				return
			}
			defer conn.Close()
			served <- agent.ServeAgent(keyring, conn)
		}()
		request := r
		request.PrivateKey, request.AuthMethod, request.IdentityAgent = "", "agent", listener.Addr().String()
		connection, err := terminal.Dial(t.Context(), request)
		if err != nil {
			t.Fatal(err)
		}
		connection.Close()
		select {
		case <-served:
		case <-time.After(5 * time.Second):
			t.Fatal("Agent 连接未释放")
		}
	})
}

type workflowTerminalStream struct {
	ctx    context.Context
	cancel context.CancelFunc
	input  chan []byte
	output chan string
}

func (s *workflowTerminalStream) Context() context.Context { return s.ctx }
func (s *workflowTerminalStream) Close() error             { s.cancel(); return nil }
func (s *workflowTerminalStream) Receive() ([]byte, error) {
	select {
	case frame := <-s.input:
		return frame, nil
	case <-s.ctx.Done():
		return nil, s.ctx.Err()
	}
}
func (s *workflowTerminalStream) Send(data []byte) error {
	select {
	case s.output <- string(data):
	case <-s.ctx.Done():
		return s.ctx.Err()
	}
	ack := make([]byte, 5)
	ack[0] = 1
	binary.BigEndian.PutUint32(ack[1:], uint32(len(data)))
	select {
	case s.input <- ack:
		return nil
	case <-s.ctx.Done():
		return s.ctx.Err()
	}
}

func TestSG1WorkflowRecordingAndTmux(t *testing.T) {
	r := sg1WorkflowRequest(t)
	t.Run("录制结束后再次开始", func(t *testing.T) {
		connection, err := terminal.Dial(t.Context(), r)
		if err != nil {
			t.Fatal(err)
		}
		defer connection.Close()
		ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
		defer cancel()
		stream := &workflowTerminalStream{ctx: ctx, cancel: cancel, input: make(chan []byte, 4), output: make(chan string, 4)}
		done := make(chan error, 1)
		go func() { done <- terminal.Relay(connection, stream) }()
		defer func() {
			cancel()
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				t.Error("真实终端 Relay 未释放")
			}
		}()
		var previous string
		for _, marker := range []string{"TQ_RECORD_ONE", "TQ_RECORD_TWO"} {
			status, err := connection.StartTimedLog(t.TempDir())
			if err != nil || status.File == previous {
				t.Fatalf("开始新录制失败: %v", err)
			}
			previous = status.File
			if err := connection.Resize(120, 40); err != nil {
				t.Fatal(err)
			}
			stream.input <- append([]byte{0}, []byte("printf '__%s__\\n' "+marker+"\n")...)
			var output strings.Builder
			for !strings.Contains(output.String(), "__"+marker+"__") {
				select {
				case chunk := <-stream.output:
					output.WriteString(chunk)
				case <-ctx.Done():
					t.Fatal("录制未收到真实终端输出")
				}
			}
			finished := connection.FinishLog()
			if finished.Recording || !finished.Finished || finished.Error != "" {
				t.Fatalf("结束录制失败: %+v", finished)
			}
			recording, err := readTerminalRecording(status.File)
			if err != nil || !strings.Contains(recording.Content, marker) {
				t.Fatalf("录制回读失败: %v", err)
			}
		}
	})
	t.Run("tmux附着与继续附着", func(t *testing.T) {
		a := testAppStore(t)
		workspace := sg1WorkflowWorkspace(t, a, r)
		remote := sg1WorkflowDirectory(t, a, workspace)
		name := "termquay-" + strings.TrimPrefix(remote, "/tmp/termquay-workflow-")
		sg1WorkflowCommand(t, a, workspace, "tmux new-session -d -s '"+name+"' -c '"+remote+"'")
		t.Cleanup(func() {
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			result, err := a.RunRemoteCommand(ctx, workspace, "tmux kill-session -t '"+name+"'", 15)
			if err != nil || result.Error != "" || result.ExitCode != 0 {
				t.Error("清理测试 tmux 会话失败")
			}
		})
		for range 2 {
			opened, err := a.CreateTmuxTerminal(t.Context(), workspace, name)
			if err != nil {
				t.Fatal(err)
			}
			a.mu.Lock()
			p := a.terminals[opened.ID]
			p.timer.Stop()
			a.mu.Unlock()
			copied := make(chan struct{})
			go func() { io.Copy(io.Discard, p.terminal.Output); close(copied) }()
			sg1WorkflowCommand(t, a, workspace, "tmux has-session -t '"+name+"'")
			a.CloseTerminal(opened.ID)
			select {
			case <-copied:
			case <-time.After(5 * time.Second):
				t.Fatal("tmux PTY 未释放")
			}
		}
		if _, err := a.CreateTmuxTerminal(t.Context(), workspace, name+"-missing"); err == nil {
			t.Fatal("不存在的 tmux 会话仍可附着")
		}
	})
}
