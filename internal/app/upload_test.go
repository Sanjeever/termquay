package app

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"github.com/pkg/sftp"
	gossh "golang.org/x/crypto/ssh"
)

func TestUploadPreparationRequiresExplicitConfirmation(t *testing.T) {
	a := NewAppService(BuildInfo{Development: true}, nil)
	a.workspaces["workspace"] = &workspaceOwner{target: "user@example.test:22"}
	local := filepath.Join(t.TempDir(), "source.bin")
	if err := os.WriteFile(local, []byte("upload"), 0600); err != nil {
		t.Fatal(err)
	}
	paths := []string{local}
	preview, err := a.prepareUploads("workspace", "/target/./files", paths)
	if err != nil {
		t.Fatal(err)
	}
	paths[0] = "changed"
	if preview.Directory != "/target/files" || preview.Target != "user@example.test:22" || len(preview.Files) != 1 || preview.Files[0].Size != 6 || !preview.Files[0].Supported {
		t.Fatalf("上传预览不完整: %+v", preview)
	}
	if len(a.ListTransfers()) != 0 || a.uploadPreview.paths[0] != local {
		t.Fatal("预览提前创建任务或未固定本地路径")
	}
	if _, err := a.prepareUploads("workspace", "/other", []string{local}); err == nil {
		t.Fatal("待确认上传被替换")
	}
	if err := a.DiscardUpload("wrong-id"); err != nil || a.uploadPreview == nil {
		t.Fatal("错误标识清除了上传预览")
	}
	if _, err := a.ConfirmUpload(context.Background(), "wrong-id", "/target", false); err == nil {
		t.Fatal("错误标识提交了上传")
	}
	if err := a.DiscardUpload(preview.ID); err != nil || a.uploadPreview != nil || len(a.ListTransfers()) != 0 {
		t.Fatal("取消上传保留预览或创建任务")
	}
}

func uploadTestClient(t *testing.T) (*AppService, *sftp.Client, string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("本地 SFTP 测试服务需要 POSIX 目录权限")
	}
	remote := filepath.ToSlash(t.TempDir())
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := gossh.NewSignerFromKey(key)
	if err != nil {
		t.Fatal(err)
	}
	config := &gossh.ServerConfig{PasswordCallback: func(metadata gossh.ConnMetadata, password []byte) (*gossh.Permissions, error) {
		if metadata.User() != "test" || string(password) != "test-only" {
			return nil, errors.New("测试认证失败")
		}
		return nil, nil
	}}
	config.AddHostKey(signer)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	go func() {
		raw, err := listener.Accept()
		if err != nil {
			return
		}
		defer raw.Close()
		conn, channels, requests, err := gossh.NewServerConn(raw, config)
		if err != nil {
			return
		}
		defer conn.Close()
		go gossh.DiscardRequests(requests)
		for next := range channels {
			if next.ChannelType() != "session" {
				next.Reject(gossh.UnknownChannelType, "测试支持 session")
				continue
			}
			channel, requests, err := next.Accept()
			if err != nil {
				continue
			}
			go func() {
				defer channel.Close()
				for request := range requests {
					switch request.Type {
					case "pty-req", "shell":
						request.Reply(true, nil)
					case "subsystem":
						var subsystem struct{ Name string }
						if gossh.Unmarshal(request.Payload, &subsystem) != nil || subsystem.Name != "sftp" {
							request.Reply(false, nil)
							continue
						}
						request.Reply(true, nil)
						server, err := sftp.NewServer(channel)
						if err != nil {
							return
						}
						server.Serve()
						server.Close()
						return
					default:
						request.Reply(false, nil)
					}
				}
			}()
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	t.Cleanup(cancel)
	term, err := terminal.Dial(ctx, terminal.Request{Host: "127.0.0.1", Port: listener.Addr().(*net.TCPAddr).Port, Username: "test", Password: "test-only", Fingerprint: gossh.FingerprintSHA256(signer.PublicKey()), Cols: 80, Rows: 24})
	if err != nil {
		t.Fatal(err)
	}
	a := NewAppService(BuildInfo{Development: true}, nil)
	a.transferEvent = func(Transfer) {}
	a.workspaces["workspace"] = &workspaceOwner{terminal: term, ctx: ctx, cancel: cancel, timer: time.NewTimer(time.Hour), target: "test@127.0.0.1"}
	t.Cleanup(func() { a.CloseWorkspace("workspace") })
	client, closeClient, err := a.fileClient(ctx, "workspace")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(closeClient)
	return a, client, remote
}

func TestConfirmUploadPublishesAndRetainsUnqueuedFiles(t *testing.T) {
	a, client, remote := uploadTestClient(t)
	local := t.TempDir()
	first, second := filepath.Join(local, "first"), filepath.Join(local, "second")
	for _, file := range []string{first, second} {
		if err := os.WriteFile(file, []byte("verified bytes"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	preview, err := a.prepareUploads("workspace", remote, []string{first, second, local})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.ConfirmUpload(context.Background(), preview.ID, remote+"/missing", false); err == nil || len(a.ListTransfers()) != 0 {
		t.Fatal("无效目标创建了任务")
	}
	if err := os.Remove(second); err != nil {
		t.Fatal(err)
	}
	result, err := a.ConfirmUpload(context.Background(), preview.ID, remote, false)
	if err != nil || len(result.Batch.Items) != 1 || len(result.Pending.Files) != 2 || len(result.Batch.Errors) != 2 {
		t.Fatalf("部分入队结果错误: %+v, %v", result, err)
	}
	if err := os.WriteFile(second, []byte("verified bytes"), 0600); err != nil {
		t.Fatal(err)
	}
	retry, err := a.ConfirmUpload(context.Background(), preview.ID, remote, false)
	if err != nil || len(retry.Batch.Items) != 1 || len(retry.Pending.Files) != 1 {
		t.Fatalf("未入队文件重试结果错误: %+v, %v", retry, err)
	}
	for _, view := range append(result.Batch.Items, retry.Batch.Items...) {
		a.mu.Lock()
		task := a.transfers[view.ID]
		a.mu.Unlock()
		select {
		case <-task.done:
		case <-time.After(5 * time.Second):
			t.Fatal("本地 SFTP 上传超时")
		}
		a.mu.Lock()
		finished := task.view
		a.mu.Unlock()
		if finished.State != "done" || finished.BatchID != preview.ID {
			t.Fatalf("本地 SFTP 上传未完成: %+v", finished)
		}
		file, err := client.Open(view.DestinationPath)
		if err != nil {
			t.Fatal(err)
		}
		got, err := io.ReadAll(file)
		file.Close()
		if err != nil || !bytes.Equal(got, []byte("verified bytes")) {
			t.Fatal("发布内容不一致")
		}
	}
	if len(a.ListTransfers()) != 2 {
		t.Fatal("重试重复上传了已入队文件")
	}
	a.CloseWorkspace("workspace")
	if a.uploadPreview != nil {
		t.Fatal("关闭工作区未释放待确认清单")
	}
}

func TestConfirmUploadPreservesQueueOverflowForRetry(t *testing.T) {
	a, _, remote := uploadTestClient(t)
	for range 33 {
		if _, err := a.startTransfer("workspace", "blocking", "download", 0, func(ctx context.Context, _ func(int64, int64)) error { <-ctx.Done(); return ctx.Err() }); err != nil {
			t.Fatal(err)
		}
	}
	local := t.TempDir()
	paths := []string{filepath.Join(local, "first"), filepath.Join(local, "second")}
	for _, file := range paths {
		if err := os.WriteFile(file, nil, 0600); err != nil {
			t.Fatal(err)
		}
	}
	preview, err := a.prepareUploads("workspace", remote, paths)
	if err != nil {
		t.Fatal(err)
	}
	result, err := a.ConfirmUpload(context.Background(), preview.ID, remote, false)
	if err != nil || len(result.Batch.Items) != 1 || len(result.Pending.Files) != 1 || result.Pending.Files[0].Error == "" {
		t.Fatalf("队列满时未保留剩余文件: %+v %v", result, err)
	}
	a.CancelTransfer(a.ListTransfers()[2].ID)
	retry, err := a.ConfirmUpload(context.Background(), preview.ID, remote, false)
	if err != nil || len(retry.Batch.Items) != 1 || retry.Pending.ID != "" || a.uploadPreview != nil {
		t.Fatalf("队列释放后无法重试: %+v %v", retry, err)
	}
}

func TestUploadPreparationReportsUnsupportedFilesAndLimits(t *testing.T) {
	a := NewAppService(BuildInfo{Development: true}, nil)
	a.workspaces["workspace"] = &workspaceOwner{}
	directory := t.TempDir()
	file := filepath.Join(directory, "source")
	if err := os.WriteFile(file, nil, 0600); err != nil {
		t.Fatal(err)
	}
	preview, err := a.prepareUploads("workspace", "/target", []string{file, directory, file, filepath.Join(directory, "missing")})
	if err != nil {
		t.Fatal(err)
	}
	if !preview.Files[0].Supported || preview.Files[0].Size != 0 || !strings.Contains(preview.Files[1].Error, "目录同步") || !strings.Contains(preview.Files[2].Error, "同名") || preview.Files[3].Error == "" {
		t.Fatalf("文件类型或同名检查失效: %+v", preview.Files)
	}
	for _, file := range preview.Files[1:] {
		if file.Supported {
			t.Fatal("接受不支持的文件")
		}
	}
	if err := a.DiscardUpload(preview.ID); err != nil {
		t.Fatal(err)
	}
	for _, paths := range [][]string{nil, make([]string, 65)} {
		if _, err := a.prepareUploads("workspace", "/target", paths); err == nil {
			t.Fatal("接受无效文件数量")
		}
	}
	if _, err := a.prepareUploads("workspace", "relative", []string{file}); err == nil {
		t.Fatal("接受远端相对目录")
	}
	if _, err := a.prepareUploads("closed", "/target", []string{file}); err == nil {
		t.Fatal("接受已关闭工作区")
	}
}
