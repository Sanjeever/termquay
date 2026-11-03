package app

import (
	"context"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"github.com/Sanjeever/termquay/internal/store"
	"net"
	"os"
	"strconv"
	"testing"
	"time"
)

func TestJumpReferences(t *testing.T) {
	a := testAppStore(t)
	jump, err := a.SaveConnection(store.Connection{Name: "跳板", Protocol: "ssh", Host: "example.invalid", Port: 22, Username: "test"}, terminal.Request{})
	if err != nil {
		t.Fatal(err)
	}
	target, err := a.SaveConnection(store.Connection{Name: "目标", Protocol: "ssh", Host: "target.invalid", Port: 22, Username: "test", JumpID: jump.ID}, terminal.Request{})
	if err != nil {
		t.Fatal(err)
	}
	if err = a.DeleteConnection(jump.ID); err == nil {
		t.Fatal("删除被引用跳板")
	}
	jump.JumpID = target.ID
	if _, err = a.SaveConnection(jump, terminal.Request{}); err == nil {
		t.Fatal("接受循环引用")
	}
	target.JumpID = target.ID
	if _, err = a.SaveConnection(target, terminal.Request{}); err == nil {
		t.Fatal("接受自引用")
	}
	previous := jump.ID
	for index := 0; index < 3; index++ {
		next, err := a.SaveConnection(store.Connection{Name: strconv.Itoa(index), Protocol: "ssh", Host: "hop.invalid", Port: 22, Username: "test", JumpID: previous}, terminal.Request{})
		if err != nil {
			t.Fatal(err)
		}
		previous = next.ID
	}
	target.JumpID = previous
	if _, err = a.SaveConnection(target, terminal.Request{}); err != nil {
		t.Fatal("四跳连接被拒绝", err)
	}
	request, _, err := a.savedRequest(target.ID)
	if err != nil {
		t.Fatal(err)
	}
	chain, err := a.resolveSSHChain(request)
	if err != nil || len(chain) != 5 {
		t.Fatal("跳板链解析顺序或长度无效", err)
	}
	if _, err = a.SaveConnection(store.Connection{Name: "超限", Protocol: "ssh", Host: "extra.invalid", Port: 22, Username: "test", JumpID: target.ID}, terminal.Request{}); err == nil {
		t.Fatal("接受超过四跳的连接")
	}
}
func TestSG1Jump(t *testing.T) {
	if os.Getenv("SSH_MCP_SERVER_SG1_PASSWORD") == "" {
		t.Skip("未配置真实 SSH 凭据")
	}
	port, err := strconv.Atoi(os.Getenv("SSH_MCP_SERVER_SG1_PORT"))
	if err != nil {
		t.Fatal(err)
	}
	fp := os.Getenv("TERMQUAY_TEST_HOST_FINGERPRINT")
	if fp == "" {
		t.Fatal("缺少独立核对指纹")
	}
	a := testAppStore(t)
	host := os.Getenv("SSH_MCP_SERVER_SG1_HOST")
	username := os.Getenv("SSH_MCP_SERVER_SG1_USERNAME")
	password := os.Getenv("SSH_MCP_SERVER_SG1_PASSWORD")
	jump, err := a.SaveConnection(store.Connection{Name: "测试跳板", Protocol: "ssh", Host: host, Port: port, Username: username}, terminal.Request{Password: password})
	if err != nil {
		t.Fatal(err)
	}
	if err = a.store.SetSetting("trust:ssh:"+net.JoinHostPort(host, strconv.Itoa(port)), fp); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	request := terminal.Request{Host: "127.0.0.1", Port: port, Username: username, Password: password, JumpID: jump.ID, Cols: 80, Rows: 24}
	probe, err := a.OpenTerminal(ctx, request)
	if err != nil || !probe.TrustRequired || probe.Fingerprint != fp || probe.TrustRole != "target" || probe.TrustVia != jump.ID {
		t.Fatalf("跳板后目标未独立核对: %v", err)
	}
	if err = a.TrustSSHHost(probe.TrustHost, probe.TrustPort, probe.Fingerprint, probe.TrustVia); err != nil {
		t.Fatal(err)
	}
	opened, err := a.OpenTerminal(ctx, request)
	if err != nil || opened.TrustRequired {
		t.Fatalf("跳板连接失败: %v", err)
	}
	defer a.CloseWorkspace(opened.ID)
	a.mu.Lock()
	a.workspaces[opened.ID].timer.Stop()
	a.mu.Unlock()
	a.CloseTerminal(opened.ID)
	directory, err := a.ReadDirectory(ctx, opened.ID, "/tmp")
	if err != nil || directory.Path != "/tmp" {
		t.Fatal("跳板后的独立 SFTP 失败")
	}
}
