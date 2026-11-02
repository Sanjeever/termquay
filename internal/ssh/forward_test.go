package ssh

import (
	"bytes"
	"context"
	"golang.org/x/net/proxy"
	"io"
	"net"
	"os"
	"strconv"
	"testing"
	"time"
)

func TestForwardValidation(t *testing.T) {
	for _, spec := range []ForwardSpec{{Kind: "local", BindHost: "0.0.0.0", TargetHost: "127.0.0.1", TargetPort: 22}, {Kind: "invalid", BindHost: "127.0.0.1"}, {Kind: "local", BindHost: "127.0.0.1", TargetPort: 0}} {
		if spec.Validate() == nil {
			t.Fatal("接受未授权或无效转发")
		}
	}
}
func TestSG1Forwarding(t *testing.T) {
	if os.Getenv("SSH_MCP_SERVER_SG1_PASSWORD") == "" {
		t.Skip("未配置真实 SSH 凭据")
	}
	port, err := strconv.Atoi(os.Getenv("SSH_MCP_SERVER_SG1_PORT"))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	r := Request{Host: os.Getenv("SSH_MCP_SERVER_SG1_HOST"), Port: port, Username: os.Getenv("SSH_MCP_SERVER_SG1_USERNAME"), Password: os.Getenv("SSH_MCP_SERVER_SG1_PASSWORD"), Fingerprint: os.Getenv("TERMQUAY_TEST_HOST_FINGERPRINT"), Cols: 80, Rows: 24}
	term, err := Dial(ctx, r)
	if err != nil {
		t.Fatal(err)
	}
	defer term.Disconnect()
	echo, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer echo.Close()
	go func() {
		for {
			conn, err := echo.Accept()
			if err != nil {
				return
			}
			go func() { defer conn.Close(); io.Copy(conn, conn) }()
		}
	}()
	_, echoPort, _ := net.SplitHostPort(echo.Addr().String())
	p, _ := strconv.Atoi(echoPort)
	remote, err := term.OpenForward(ctx, ctx, ForwardSpec{Kind: "remote", BindHost: "127.0.0.1", TargetHost: "127.0.0.1", TargetPort: p})
	if err != nil {
		t.Fatal(err)
	}
	defer remote.Close()
	_, remotePort, _ := net.SplitHostPort(remote.Info().Address)
	rp, _ := strconv.Atoi(remotePort)
	local, err := term.OpenForward(ctx, ctx, ForwardSpec{Kind: "local", BindHost: "127.0.0.1", TargetHost: "127.0.0.1", TargetPort: rp})
	if err != nil {
		t.Fatal(err)
	}
	defer local.Close()
	dynamic, err := term.OpenForward(ctx, ctx, ForwardSpec{Kind: "dynamic", BindHost: "127.0.0.1"})
	if err != nil {
		t.Fatal(err)
	}
	defer dynamic.Close()
	data := bytes.Repeat([]byte{0, 1, 127, 255}, 1<<16)
	roundTrip := func(conn net.Conn) {
		t.Helper()
		defer conn.Close()
		conn.SetDeadline(time.Now().Add(5 * time.Second))
		done := make(chan error, 1)
		go func() { _, err := conn.Write(data); done <- err }()
		got := make([]byte, len(data))
		if _, err := io.ReadFull(conn, got); err != nil {
			t.Fatal(err)
		}
		if err := <-done; err != nil || !bytes.Equal(data, got) {
			t.Fatal("转发往返字节不一致")
		}
	}
	conn, err := net.Dial("tcp", local.Info().Address)
	if err != nil {
		t.Fatal(err)
	}
	roundTrip(conn)
	conn, err = term.client.DialContext(ctx, "tcp", remote.Info().Address)
	if err != nil {
		t.Fatal(err)
	}
	roundTrip(conn)
	dialer, err := proxy.SOCKS5("tcp", dynamic.Info().Address, nil, proxy.Direct)
	if err != nil {
		t.Fatal(err)
	}
	conn, err = dialer.Dial("tcp", net.JoinHostPort("localhost", remotePort))
	if err != nil {
		t.Fatal(err)
	}
	roundTrip(conn)
	for _, f := range []*Forward{local, dynamic, remote} {
		f.Close()
		if err = f.Wait(ctx); err != nil {
			t.Fatal(err)
		}
		if info := f.Info(); info.State != "closed" || info.Active != 0 {
			t.Fatal("转发未释放监听或连接")
		}
	}
}
