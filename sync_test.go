package main

import (
	"bytes"
	"context"
	"fmt"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

func TestSG1DirectorySync(t *testing.T) {
	password := os.Getenv("SSH_MCP_SERVER_SG1_PASSWORD")
	if password == "" {
		t.Skip("未配置真实 SSH 凭据")
	}
	port, err := strconv.Atoi(os.Getenv("SSH_MCP_SERVER_SG1_PORT"))
	if err != nil {
		t.Fatal(err)
	}
	fingerprint := os.Getenv("TERMQUAY_TEST_HOST_FINGERPRINT")
	if fingerprint == "" {
		t.Fatal("缺少独立核对的指纹")
	}
	a := testAppStore(t)
	a.transferEvent = func(Transfer) {}
	host := os.Getenv("SSH_MCP_SERVER_SG1_HOST")
	if err = a.store.SetSetting("trust:ssh:"+net.JoinHostPort(host, strconv.Itoa(port)), fingerprint); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	opened, err := a.OpenTerminal(ctx, terminal.Request{Host: host, Port: port, Username: os.Getenv("SSH_MCP_SERVER_SG1_USERNAME"), Password: password, Cols: 80, Rows: 24})
	if err != nil || opened.TrustRequired {
		t.Fatalf("SSH 未建立: %v", err)
	}
	t.Cleanup(func() { a.CloseWorkspace(opened.ID) })
	a.mu.Lock()
	a.workspaces[opened.ID].timer.Stop()
	a.mu.Unlock()
	a.CloseTerminal(opened.ID)
	c, done, err := a.fileClient(ctx, opened.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer done()
	remote := fmt.Sprintf("/tmp/termquay-sync-%d", time.Now().UnixNano())
	if err = c.Mkdir(remote); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, closeClient, err := a.fileClient(context.Background(), opened.ID)
		if err != nil {
			t.Error("同步清理无法连接")
			return
		}
		defer closeClient()
		for _, name := range []string{"sub/test.bin", "extra.txt", "unsafe"} {
			cleanup.Remove(remote + "/" + name)
		}
		for _, name := range []string{"sub", "empty", ""} {
			if err = cleanup.RemoveDirectory(remote + "/" + name); err != nil {
				t.Error("同步测试目录清理失败")
			}
		}
	})
	local := t.TempDir()
	for _, name := range []string{"sub", "empty"} {
		if err = os.Mkdir(filepath.Join(local, name), 0700); err != nil {
			t.Fatal(err)
		}
	}
	data := bytes.Repeat([]byte{0, 1, 255}, 1<<18)
	source := filepath.Join(local, "sub", "test.bin")
	if err = os.WriteFile(source, data, 0600); err != nil {
		t.Fatal(err)
	}
	extra, err := c.Create(remote + "/extra.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = extra.Write([]byte("keep")); err != nil {
		t.Fatal(err)
	}
	extra.Close()
	wait := func(view Transfer, want string) {
		t.Helper()
		a.mu.Lock()
		task := a.transfers[view.ID]
		a.mu.Unlock()
		select {
		case <-task.done:
		case <-ctx.Done():
			t.Fatal("同步执行超时")
		}
		a.mu.Lock()
		defer a.mu.Unlock()
		if task.view.State != want {
			t.Fatalf("同步状态 %s，期望 %s: %s", task.view.State, want, task.view.Error)
		}
	}
	preview, err := a.previewDirectorySync(ctx, opened.ID, "upload", local, remote)
	if err != nil {
		t.Fatal(err)
	}
	if len(preview.Entries) != 3 {
		t.Fatal("预览包含额外目标或遗漏空目录")
	}
	task, err := a.ExecuteDirectorySync(preview.ID, []string{"sub", "empty"})
	if err != nil {
		t.Fatal(err)
	}
	wait(task, "done")
	preview, err = a.previewDirectorySync(ctx, opened.ID, "upload", local, remote)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range preview.Entries {
		if e.State != "same" {
			t.Fatal("同步后时间或大小不一致")
		}
	}
	a.CancelDirectorySyncPreview(preview.ID)
	if _, err = c.Lstat(remote + "/extra.txt"); err != nil {
		t.Fatal("同步删除多余目标")
	}
	if err = os.WriteFile(source, append(data, 1), 0600); err != nil {
		t.Fatal(err)
	}
	preview, err = a.previewDirectorySync(ctx, opened.ID, "upload", local, remote)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(source, append(data, 1, 2), 0600); err != nil {
		t.Fatal(err)
	}
	task, err = a.ExecuteDirectorySync(preview.ID, []string{"sub/test.bin"})
	if err != nil {
		t.Fatal(err)
	}
	wait(task, "failed")
	preview, err = a.previewDirectorySync(ctx, opened.ID, "upload", local, remote)
	if err != nil {
		t.Fatal(err)
	}
	changed, err := c.OpenFile(remote+"/sub/test.bin", os.O_WRONLY|os.O_APPEND)
	if err != nil {
		t.Fatal(err)
	}
	changed.Write([]byte{8})
	changed.Close()
	task, err = a.ExecuteDirectorySync(preview.ID, []string{"sub/test.bin"})
	if err != nil {
		t.Fatal(err)
	}
	wait(task, "failed")
	download := t.TempDir()
	preview, err = a.previewDirectorySync(ctx, opened.ID, "download", download, remote)
	if err != nil {
		t.Fatal(err)
	}
	task, err = a.ExecuteDirectorySync(preview.ID, []string{"sub", "empty", "extra.txt"})
	if err != nil {
		t.Fatal(err)
	}
	wait(task, "done")
	got, err := os.ReadFile(filepath.Join(download, "sub", "test.bin"))
	if err != nil || !bytes.Equal(got, append(data, 8)) {
		t.Fatal("远端到本地同步内容不一致")
	}
	if err = c.Symlink("/tmp", remote+"/unsafe"); err != nil {
		t.Fatal(err)
	}
	preview, err = a.previewDirectorySync(ctx, opened.ID, "download", download, remote)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.ExecuteDirectorySync(preview.ID, []string{"unsafe"}); err == nil {
		t.Fatal("符号链接进入执行计划")
	}
	if _, err = a.ExecuteDirectorySync(preview.ID, []string{"../escape"}); err == nil {
		t.Fatal("越界选择进入执行计划")
	}
	a.CancelDirectorySyncPreview(preview.ID)
}
