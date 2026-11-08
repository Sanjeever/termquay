package app

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

func TestTransferCopyCancellationAndProgress(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var target bytes.Buffer
	var reported int64
	writer := &transferWriter{ctx: ctx, writer: &target, total: 1 << 20, report: func(done, total int64) {
		reported = done
		if total != 1<<20 {
			t.Fatal("总大小不一致")
		}
		cancel()
	}}
	_, err := io.CopyBuffer(writer, io.LimitReader(bytes.NewReader(make([]byte, 1<<20)), 1<<20), make([]byte, 32<<10))
	if !errors.Is(err, context.Canceled) {
		t.Fatal("取消没有终止复制")
	}
	if target.Len() != 32<<10 || reported != 32<<10 {
		t.Fatal("取消后继续写入或进度不一致")
	}
}

func TestTransferCopyPreservesBytes(t *testing.T) {
	data := bytes.Repeat([]byte{0, 255, 13, 10, 27}, 100000)
	var target bytes.Buffer
	var reported int64
	writer := &transferWriter{ctx: context.Background(), writer: &target, total: int64(len(data)), report: func(done, total int64) { reported = done }}
	if _, err := io.CopyBuffer(writer, io.LimitReader(bytes.NewReader(data), int64(len(data))), make([]byte, 64<<10)); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(target.Bytes(), data) || reported != int64(len(data)) {
		t.Fatal("传输改变协议字节或进度不一致")
	}
}

func TestClearTransferRequiresStoppedAndDiscarded(t *testing.T) {
	a := NewAppService(BuildInfo{Development: true}, nil)
	for _, state := range []string{"queued", "running", "cancelled"} {
		task := &transferTask{view: Transfer{ID: "test", State: state}}
		if state == "cancelled" {
			task.resume = &transferResume{}
		}
		a.transfers["test"] = task
		if _, err := a.ClearTransfer("test"); err == nil || a.transfers["test"] == nil {
			t.Fatalf("移除了尚未处理的任务 %s", state)
		}
	}
	a.transfers["test"].resume = nil
	if id, err := a.ClearTransfer("test"); err != nil || id != "test" || len(a.ListTransfers()) != 0 {
		t.Fatalf("移除记录失败: %s %v", id, err)
	}
}

func TestCancelAndDiscardWaitsForWriter(t *testing.T) {
	a := NewAppService(BuildInfo{Development: true}, nil)
	a.transferEvent = func(Transfer) {}
	a.workspaces["test"] = &workspaceOwner{}
	filename := filepath.Join(t.TempDir(), ".termquay-download-test")
	if err := os.WriteFile(filename, []byte("partial"), 0600); err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	view, err := a.startTransfer("test", "file", "download", 7, func(ctx context.Context, _ func(int64, int64)) error {
		close(started)
		<-ctx.Done()
		if !a.retainTransfer(ctx, &transferResume{temporary: filename, offset: 7}) {
			return errors.New("未保留暂存")
		}
		return ctx.Err()
	}, transferSpec{direction: "download"})
	if err != nil {
		t.Fatal(err)
	}
	<-started
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := a.CancelAndDiscardTransfer(ctx, view.ID, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filename); !os.IsNotExist(err) || len(a.ListTransfers()) != 0 {
		t.Fatal("取消后临时文件或记录仍存在")
	}
}

func TestDownloadBatchUsesBoundedQueue(t *testing.T) {
	a := NewAppService(BuildInfo{Development: true}, nil)
	a.transferEvent = func(Transfer) {}
	a.workspaces["test"] = &workspaceOwner{}
	for i := 0; i < 2; i++ {
		if _, err := a.startTransfer("test", "blocking", "download", 0, func(ctx context.Context, _ func(int64, int64)) error { <-ctx.Done(); return ctx.Err() }); err != nil {
			t.Fatal(err)
		}
	}
	paths := make([]string, 64)
	for i := range paths {
		paths[i] = fmt.Sprintf("/tmp/file-%d", i)
	}
	batch, err := a.downloadFiles("test", t.TempDir(), paths, false)
	if err != nil || len(batch.Items) != 32 || len(batch.Errors) != 32 {
		t.Fatalf("批量下载绕过限额: items=%d errors=%d err=%v", len(batch.Items), len(batch.Errors), err)
	}
	views := a.ListTransfers()
	for i := len(views) - 1; i >= 0; i-- {
		a.CancelTransfer(views[i].ID)
	}
	for _, task := range a.transfers {
		select {
		case <-task.done:
		case <-time.After(3 * time.Second):
			t.Fatal("取消未释放任务")
		}
	}
	for _, paths := range [][]string{nil, {"/"}, {"relative"}, {"/tmp/a", "/tmp/a"}, make([]string, 65)} {
		if err := validateRemotePaths(paths); err == nil {
			t.Fatal("接受无效路径批次")
		}
	}
}

func TestClearFinishedTransfersPreservesActiveAndTarget(t *testing.T) {
	a := NewAppService(BuildInfo{Development: true}, nil)
	a.transferEvent = func(Transfer) {}
	a.workspaces["test"] = &workspaceOwner{target: "test@example.invalid:22"}
	views := []Transfer{}
	for i := 0; i < 3; i++ {
		direction := "upload"
		if i == 1 {
			direction = "download"
		}
		specDirection := direction
		if i == 2 {
			specDirection = "sync"
		}
		v, err := a.startTransfer("test", "file", direction, 0, func(ctx context.Context, _ func(int64, int64)) error { <-ctx.Done(); return ctx.Err() }, transferSpec{direction: specDirection, local: "/tmp/source", remote: "/remote/target"})
		if err != nil {
			t.Fatal(err)
		}
		views = append(views, v)
	}
	a.transfers["finished"] = &transferTask{view: Transfer{ID: "finished", State: "done"}}
	removed := a.ClearFinishedTransfers()
	if len(removed) != 1 || removed[0] != "finished" || len(a.ListTransfers()) != 3 {
		t.Fatal("清理移除了活动任务")
	}
	for _, v := range views {
		source, target := "/tmp/source", "/remote/target"
		if v.Direction == "download" {
			source, target = target, source
		}
		if v.Target != "test@example.invalid:22" || v.SourcePath != source || v.DestinationPath != target {
			t.Fatal("传输未保存所属目标和路径")
		}
		a.CancelTransfer(v.ID)
	}
	for _, task := range a.transfers {
		select {
		case <-task.done:
		case <-time.After(3 * time.Second):
			t.Fatal("取消未完成")
		}
	}
	delete(a.workspaces, "test")
	if a.ListTransfers()[0].Target != "test@example.invalid:22" {
		t.Fatal("工作区关闭丢失传输目标")
	}
}

func TestTransferQueueFIFOAndWaitingCancellation(t *testing.T) {
	a := NewAppService(BuildInfo{Development: true}, nil)
	a.transferEvent = func(Transfer) {}
	a.workspaces["workspace"] = &workspaceOwner{}
	started := make(chan int, 5)
	gates := make([]chan struct{}, 5)
	views := make([]Transfer, 5)
	for i := range gates {
		gates[i] = make(chan struct{})
		i := i
		view, err := a.startTransfer("workspace", "test", "upload", 0, func(ctx context.Context, _ func(int64, int64)) error {
			started <- i
			select {
			case <-gates[i]:
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		})
		if err != nil {
			t.Fatal(err)
		}
		views[i] = view
	}
	t.Cleanup(func() {
		for _, view := range views {
			a.CancelTransfer(view.ID)
		}
	})
	next := func() int {
		t.Helper()
		select {
		case i := <-started:
			return i
		case <-time.After(3 * time.Second):
			t.Fatal("等待队列未推进")
			return -1
		}
	}
	first, second := next(), next()
	if first+second != 1 {
		t.Fatal("并行任务不是最先进入的两项")
	}
	a.ClearTransfer(views[3].ID)
	a.mu.Lock()
	exists := a.transfers[views[3].ID] != nil
	a.mu.Unlock()
	if !exists {
		t.Fatal("等待任务被移除")
	}
	a.CancelTransfer(views[3].ID)
	close(gates[0])
	if next() != 2 {
		t.Fatal("未按 FIFO 调度")
	}
	close(gates[1])
	if next() != 4 {
		t.Fatal("已取消等待任务仍被执行")
	}
	close(gates[2])
	close(gates[4])
	for _, view := range views {
		a.mu.Lock()
		done := a.transfers[view.ID].done
		a.mu.Unlock()
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			t.Fatal("任务未结束")
		}
	}
	if a.transfers[views[3].ID].view.State != "cancelled" {
		t.Fatal("等待取消状态错误")
	}
}

func TestTransferQueueBound(t *testing.T) {
	a := NewAppService(BuildInfo{Development: true}, nil)
	a.transferEvent = func(Transfer) {}
	a.workspaces["workspace"] = &workspaceOwner{}
	views := []Transfer{}
	t.Cleanup(func() {
		for _, v := range views {
			a.CancelTransfer(v.ID)
		}
	})
	for range 34 {
		v, err := a.startTransfer("workspace", "test", "upload", 0, func(ctx context.Context, _ func(int64, int64)) error { <-ctx.Done(); return ctx.Err() })
		if err != nil {
			t.Fatal(err)
		}
		views = append(views, v)
	}
	if _, err := a.startTransfer("workspace", "overflow", "upload", 0, func(context.Context, func(int64, int64)) error { return nil }); err == nil {
		t.Fatal("等待队列超过 32 项")
	}
	for _, v := range views {
		a.CancelTransfer(v.ID)
	}
	for _, v := range views {
		select {
		case <-a.transfers[v.ID].done:
		case <-time.After(3 * time.Second):
			t.Fatal("取消后未释放任务")
		}
	}
}

func TestSG1Transfers(t *testing.T) {
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
		t.Fatal("缺少经独立核对的指纹")
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
	c, closeClient, err := a.fileClient(ctx, opened.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer closeClient()
	remote := fmt.Sprintf("/tmp/termquay-transfer-%d", time.Now().UnixNano())
	if err = c.Mkdir(remote); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, done, err := a.fileClient(context.Background(), opened.ID)
		if err != nil {
			t.Error("测试清理无法建立 SFTP")
			return
		}
		defer done()
		for _, name := range []string{"source.bin", "renamed.bin", "batch/source.bin"} {
			cleanup.Remove(remote + "/" + name)
		}
		cleanup.RemoveDirectory(remote + "/batch")
		if err = cleanup.RemoveDirectory(remote); err != nil {
			t.Error("测试目录清理失败")
		}
	})
	local := filepath.Join(t.TempDir(), "source.bin")
	data := bytes.Repeat([]byte{0, 1, 2, 255}, 1<<20)
	if err = os.WriteFile(local, data, 0600); err != nil {
		t.Fatal(err)
	}
	wait := func(view Transfer, want string) {
		t.Helper()
		a.mu.Lock()
		task := a.transfers[view.ID]
		a.mu.Unlock()
		select {
		case <-task.done:
		case <-ctx.Done():
			t.Fatal("真实传输超时")
		}
		a.mu.Lock()
		defer a.mu.Unlock()
		if task.view.State != want {
			t.Fatalf("传输状态 %s，期望 %s: %s", task.view.State, want, task.view.Error)
		}
	}
	upload, err := a.uploadPath(opened.ID, local, remote+"/source.bin", false)
	if err != nil {
		t.Fatal(err)
	}
	wait(upload, "done")
	skipped, err := a.uploadPath(opened.ID, local, remote+"/source.bin", false)
	if err != nil {
		t.Fatal(err)
	}
	wait(skipped, "skipped")
	renamed, err := a.RetryTransfer(skipped.ID, "renamed.bin", false)
	if err != nil {
		t.Fatal(err)
	}
	wait(renamed, "done")
	data = append(data, 3)
	if err = os.WriteFile(local, data, 0600); err != nil {
		t.Fatal(err)
	}
	overwritten, err := a.uploadPath(opened.ID, local, remote+"/source.bin", true)
	if err != nil {
		t.Fatal(err)
	}
	wait(overwritten, "done")
	downloadPath := filepath.Join(t.TempDir(), "download.bin")
	download, err := a.downloadPath(opened.ID, remote+"/source.bin", downloadPath, false)
	if err != nil {
		t.Fatal(err)
	}
	wait(download, "done")
	got, err := os.ReadFile(downloadPath)
	if err != nil || !bytes.Equal(got, data) {
		t.Fatal("真实传输往返内容不一致")
	}

	batchDir := t.TempDir()
	batch, err := a.downloadFiles(opened.ID, batchDir, []string{remote + "/source.bin", remote + "/renamed.bin"}, false)
	if err != nil || len(batch.Items) != 2 || len(batch.Errors) != 0 {
		t.Fatalf("批量下载入队失败: %v", err)
	}
	for _, view := range batch.Items {
		wait(view, "done")
	}
	got, err = os.ReadFile(filepath.Join(batchDir, "source.bin"))
	if err != nil || !bytes.Equal(got, data) {
		t.Fatal("批量下载内容不一致")
	}
	batch, err = a.downloadFiles(opened.ID, batchDir, []string{remote + "/source.bin"}, false)
	if err != nil {
		t.Fatal(err)
	}
	wait(batch.Items[0], "skipped")
	if err := c.Mkdir(remote + "/batch"); err != nil {
		t.Fatal(err)
	}
	results, err := a.MoveRemotePaths(ctx, opened.ID, []string{remote + "/source.bin", remote + "/missing"}, remote+"/batch")
	if err != nil || len(results) != 2 || results[0].State != "done" || results[1].State != "failed" {
		t.Fatalf("批量移动未按项报告: %+v %v", results, err)
	}
	if err := a.RenameRemotePath(ctx, opened.ID, remote+"/renamed.bin", remote+"/source.bin"); err != nil {
		t.Fatal(err)
	}
	results, err = a.MoveRemotePaths(ctx, opened.ID, []string{remote + "/source.bin"}, remote+"/batch")
	if err != nil || results[0].State != "failed" {
		t.Fatal("批量移动覆盖已有文件")
	}
	results, err = a.DeleteRemotePaths(ctx, opened.ID, []string{remote + "/batch", remote + "/source.bin", remote + "/missing"})
	if err != nil || results[0].State != "failed" || results[1].State != "done" || results[2].State != "failed" {
		t.Fatalf("批量删除扩展了递归能力或未准确报告: %+v %v", results, err)
	}
}
