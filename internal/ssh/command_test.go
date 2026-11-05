package ssh

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"net"
	"strings"
	"testing"
	"time"

	gossh "golang.org/x/crypto/ssh"
)

func TestCommandOpeningCancellationRetainsSlots(t *testing.T) {
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := gossh.NewSignerFromKey(key)
	if err != nil {
		t.Fatal(err)
	}
	config := &gossh.ServerConfig{NoClientAuth: true}
	config.AddHostKey(signer)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	opened := make(chan struct{}, 4)
	serverReady := make(chan *gossh.ServerConn, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		server, channels, requests, err := gossh.NewServerConn(conn, config)
		if err != nil {
			conn.Close()
			return
		}
		serverReady <- server
		go gossh.DiscardRequests(requests)
		for range channels {
			opened <- struct{}{}
		}
	}()
	client, err := gossh.Dial("tcp", listener.Addr().String(), &gossh.ClientConfig{User: "test", HostKeyCallback: gossh.FixedHostKey(signer.PublicKey()), Timeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	server := <-serverReady
	defer server.Close()
	terminal := &Terminal{client: client}
	for i := 0; i < 4; i++ {
		ctx, cancel := context.WithCancel(context.Background())
		ready := make(chan CommandResult, 1)
		go func() { ready <- terminal.RunCommand(ctx, "true") }()
		select {
		case <-opened:
		case <-time.After(3 * time.Second):
			cancel()
			t.Fatal("未收到通道打开请求")
		}
		cancel()
		select {
		case result := <-ready:
			if result.ExitCode != -1 || result.Error == "" {
				t.Fatal(result)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("取消未返回")
		}
	}
	result := terminal.RunCommand(context.Background(), "true")
	if !strings.Contains(result.Error, "上限") {
		t.Fatalf("未保留底层槽位：%+v", result)
	}
	if len(terminal.commandRequests) != 4 {
		t.Fatal("取消提前释放底层请求")
	}
	server.Close()
	deadline := time.After(3 * time.Second)
	for len(terminal.commandRequests) != 0 {
		select {
		case <-deadline:
			t.Fatal("实际结束未释放槽位")
		case <-time.After(time.Millisecond):
		}
	}
}
