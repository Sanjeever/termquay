package app

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/Sanjeever/termquay/internal/files"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
)

func sg1WorkflowRequest(t *testing.T) terminal.Request {
	t.Helper()
	keyPath := os.Getenv("TERMQUAY_TEST_PRIVATE_KEY_PATH")
	if keyPath == "" {
		t.Skip("未配置真实 SSH 私钥路径")
	}
	key, err := os.ReadFile(keyPath)
	if err != nil {
		t.Fatal("无法读取测试私钥")
	}
	port, err := strconv.Atoi(os.Getenv("SSH_MCP_SERVER_SG1_PORT"))
	if err != nil {
		t.Fatal("测试端口无效")
	}
	r := terminal.Request{Host: os.Getenv("SSH_MCP_SERVER_SG1_HOST"), Port: port, Username: os.Getenv("SSH_MCP_SERVER_SG1_USERNAME"), PrivateKey: string(key), Fingerprint: os.Getenv("TERMQUAY_TEST_HOST_FINGERPRINT"), Cols: 100, Rows: 30}
	if r.Host == "" || r.Username == "" || r.Fingerprint == "" {
		t.Fatal("缺少测试目标或已核对指纹")
	}
	return r
}

func sg1WorkflowWorkspace(t *testing.T, a *AppService, r terminal.Request) string {
	t.Helper()
	if err := a.store.SetSetting("trust:ssh:"+net.JoinHostPort(r.Host, strconv.Itoa(r.Port)), r.Fingerprint); err != nil {
		t.Fatal(err)
	}
	opened, err := a.OpenTerminal(t.Context(), r)
	if err != nil || opened.TrustRequired {
		t.Fatalf("真实 SSH 工作区建立失败: %v", err)
	}
	t.Cleanup(func() { a.CloseWorkspace(opened.ID) })
	a.mu.Lock()
	a.workspaces[opened.ID].timer.Stop()
	a.mu.Unlock()
	a.CloseTerminal(opened.ID)
	return opened.ID
}

func sg1WorkflowCommand(t *testing.T, a *AppService, workspace, script string) terminal.CommandResult {
	t.Helper()
	result, err := a.RunRemoteCommand(t.Context(), workspace, script, 15)
	if err != nil || result.Error != "" || result.ExitCode != 0 || result.Truncated {
		t.Fatalf("测试命令失败: err=%v, exit=%d, error=%s, stderr=%s", err, result.ExitCode, result.Error, result.Stderr)
	}
	return result
}

func sg1WorkflowDirectory(t *testing.T, a *AppService, workspace string) string {
	t.Helper()
	remote := strings.TrimSpace(sg1WorkflowCommand(t, a, workspace, "mktemp -d /tmp/termquay-workflow-XXXXXXXXXX").Stdout)
	if !strings.HasPrefix(remote, "/tmp/termquay-workflow-") || strings.ContainsAny(remote, "'\r\n") {
		t.Fatal("测试目录无效")
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		result, err := a.RunRemoteCommand(ctx, workspace, "rm -rf -- '"+remote+"'", 15)
		if err != nil || result.Error != "" || result.ExitCode != 0 {
			t.Errorf("清理测试目录失败: %v, %s", err, result.Error)
		}
	})
	return remote
}

func sg1WorkflowWaitTransfer(t *testing.T, a *AppService, id, expected string) Transfer {
	t.Helper()
	a.mu.Lock()
	task := a.transfers[id]
	a.mu.Unlock()
	select {
	case <-task.done:
	case <-time.After(90 * time.Second):
		t.Fatal("等待真实传输超时")
	}
	a.mu.Lock()
	view := task.view
	a.mu.Unlock()
	if view.State != expected {
		t.Fatalf("传输状态=%s，期望=%s，错误=%s", view.State, expected, view.Error)
	}
	return view
}

func sg1WorkflowInterruptTransfer(t *testing.T, a *AppService, id string) {
	t.Helper()
	deadline := time.NewTimer(20 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		a.mu.Lock()
		progress := a.transfers[id].view.Completed
		a.mu.Unlock()
		if progress > 0 {
			break
		}
		select {
		case <-ticker.C:
		case <-deadline.C:
			t.Fatal("限速传输没有进度")
		}
	}
	a.CancelTransfer(id)
	partial := sg1WorkflowWaitTransfer(t, a, id, "cancelled")
	if !partial.Resumable || !partial.ResumePersisted || partial.Completed >= partial.Total {
		t.Fatalf("续传记录无效: resumable=%v, persisted=%v, bytes=%d", partial.Resumable, partial.ResumePersisted, partial.Completed)
	}
}

func TestSG1WorkflowIdentityAndCommands(t *testing.T) {
	r := sg1WorkflowRequest(t)
	t.Run("主机身份变化阻断", func(t *testing.T) {
		wrong := r
		wrong.Fingerprint = "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
		connection, err := terminal.Dial(t.Context(), wrong)
		if connection != nil {
			connection.Close()
		}
		var identity *terminal.HostKeyError
		if !errors.As(err, &identity) || identity.Fingerprint != r.Fingerprint {
			t.Fatalf("未报告真实身份变化: %v", err)
		}
	})
	a := testAppStore(t)
	a.transferEvent = func(Transfer) {}
	workspace := sg1WorkflowWorkspace(t, a, r)
	t.Run("退出码与输出分离", func(t *testing.T) {
		result, err := a.RunRemoteCommand(t.Context(), workspace, "printf 'stdout中文'; printf 'stderr中文' >&2; exit 7", 10)
		if err != nil || result.Error != "" || result.ExitCode != 7 || result.Stdout != "stdout中文" || result.Stderr != "stderr中文" {
			t.Fatalf("命令结果无效: err=%v, result=%+v", err, result)
		}
	})
	t.Run("输出截断", func(t *testing.T) {
		result, err := a.RunRemoteCommand(t.Context(), workspace, "head -c 100000 /dev/zero", 10)
		if err != nil || result.Error != "" || result.ExitCode != 0 || !result.Truncated || len(result.Stdout) != 64<<10 {
			t.Fatalf("输出未按边界截断: err=%v, bytes=%d, truncated=%v", err, len(result.Stdout), result.Truncated)
		}
	})
	t.Run("错误输出截断", func(t *testing.T) {
		result, err := a.RunRemoteCommand(t.Context(), workspace, "head -c 20000 /dev/zero >&2", 10)
		if err != nil || result.Error != "" || result.ExitCode != 0 || !result.Truncated || len(result.Stderr) != 16<<10 || result.Stdout != "" {
			t.Fatalf("错误输出未按边界截断: err=%v, bytes=%d, truncated=%v", err, len(result.Stderr), result.Truncated)
		}
	})
	t.Run("超时后连接可用", func(t *testing.T) {
		result, err := a.RunRemoteCommand(t.Context(), workspace, "exec sleep 3", 1)
		if err != nil || result.Error == "" {
			t.Fatalf("超时未暴露: %v, %+v", err, result)
		}
		if got := sg1WorkflowCommand(t, a, workspace, "printf alive").Stdout; got != "alive" {
			t.Fatal("超时破坏共享连接")
		}
	})
	t.Run("Linux与Docker只读诊断", func(t *testing.T) {
		processes, err := a.ListLinuxProcesses(t.Context(), workspace, "cpu")
		if err != nil || len(processes.Items) == 0 {
			t.Fatalf("进程查询失败: %v", err)
		}
		services, err := a.ListLinuxServices(t.Context(), workspace, "ssh")
		if err != nil || len(services.Items) == 0 {
			t.Fatalf("服务查询失败: %v", err)
		}
		if _, err := a.ReadLinuxServiceDetails(t.Context(), workspace, "ssh.service"); err != nil {
			t.Fatal(err)
		}
		if _, err := a.ReadLinuxServiceLog(t.Context(), workspace, "ssh.service"); err != nil {
			t.Fatal(err)
		}
		containers, err := a.ListContainers(t.Context(), workspace, "/var/run/docker.sock")
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("应用链路读取 %d 个进程、%d 个服务、%d 个容器", len(processes.Items), len(services.Items), len(containers))
	})
}

func TestSG1WorkflowEditingSearchAndSudo(t *testing.T) {
	a := testAppStore(t)
	a.transferEvent = func(Transfer) {}
	workspace := sg1WorkflowWorkspace(t, a, sg1WorkflowRequest(t))
	remote := sg1WorkflowDirectory(t, a, workspace)
	filename := remote + "/中文 '配置.txt"
	sg1WorkflowCommand(t, a, workspace, "printf '初始\\n' > "+sudoQuote(filename)+"; chmod 640 -- "+sudoQuote(filename))
	document, err := a.ReadRemoteFile(t.Context(), workspace, filename)
	if err != nil {
		t.Fatal(err)
	}
	for _, encoding := range []string{"GBK", "GB2312", "GB18030", "UTF-8"} {
		document.OriginalEncoding = document.Encoding
		document.Content, document.Encoding, document.LineEnding, document.BOM = "name: 中文\nvalue: 测试\n", encoding, "CRLF", encoding == "UTF-8"
		expected, err := files.EncodeDocument(document)
		if err != nil {
			t.Fatal(err)
		}
		document, err = a.SaveRemoteFile(t.Context(), workspace, document)
		if err != nil {
			t.Fatalf("编码 %s 保存失败: %v", encoding, err)
		}
		client, release, err := a.fileClient(t.Context(), workspace)
		if err != nil {
			t.Fatal(err)
		}
		file, err := client.Open(filename)
		if err != nil {
			release()
			t.Fatal(err)
		}
		actual, readErr := io.ReadAll(file)
		info, statErr := file.Stat()
		file.Close()
		release()
		if readErr != nil || statErr != nil || !bytes.Equal(expected, actual) || info.Mode().Perm() != 0640 {
			t.Fatalf("编码 %s 的字节或权限不一致", encoding)
		}
	}
	history, err := a.GetFileHistory(workspace, filename)
	if err != nil || len(history.Versions) != 4 {
		t.Fatalf("文件历史不完整: %v, versions=%d", err, len(history.Versions))
	}
	stale := document
	document.Content = "changed\n"
	document, err = a.SaveRemoteFile(t.Context(), workspace, document)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.SaveRemoteFile(t.Context(), workspace, stale); err == nil {
		t.Fatal("旧版本覆盖未被阻止")
	}
	if err := a.SetWorkspaceBrowseOnly(workspace, true); err != nil {
		t.Fatal(err)
	}
	if _, err := a.SaveRemoteFile(t.Context(), workspace, document); err == nil {
		t.Fatal("浏览模式允许保存")
	}
	if err := a.SetWorkspaceBrowseOnly(workspace, false); err != nil {
		t.Fatal(err)
	}
	sg1WorkflowCommand(t, a, workspace, "printf 'needle 中文\\n' > '"+remote+"/search.txt'; ln -s . '"+remote+"/loop'")
	result, err := a.SearchRemoteFiles(t.Context(), workspace, files.SearchOptions{Root: remote, Query: "needle", Content: true})
	if err != nil || len(result.Matches) != 1 || result.Failed != 0 || result.StopReason != "" {
		t.Fatalf("真实搜索或循环链接处理失败: err=%v, matches=%d, failed=%d, stop=%s", err, len(result.Matches), result.Failed, result.StopReason)
	}
	log, err := a.ReadRemoteLog(t.Context(), workspace, remote+"/search.txt", -1, false)
	if err != nil || log.Content != "needle 中文\n" {
		t.Fatalf("日志读取失败: %v", err)
	}
	sudo, err := a.ReadSudoFile(t.Context(), workspace, filename, "UTF-8", "")
	if err != nil {
		t.Fatal(err)
	}
	sudo.Content = "sudo 中文\n"
	if _, err := a.SaveSudoFile(t.Context(), workspace, sudo, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := a.SaveSudoFile(t.Context(), workspace, sudo, ""); err == nil {
		t.Fatal("sudo 旧版本覆盖未被阻止")
	}
}

func TestSG1WorkflowResumeAndRemoteCopy(t *testing.T) {
	a := testAppStore(t)
	a.transferEvent = func(Transfer) {}
	r := sg1WorkflowRequest(t)
	workspace := sg1WorkflowWorkspace(t, a, r)
	remote := sg1WorkflowDirectory(t, a, workspace)
	local := filepath.Join(t.TempDir(), "source.bin")
	data := bytes.Repeat([]byte{0, 1, 127, 255}, 128<<10)
	if err := os.WriteFile(local, data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := a.SetTransferRate(256); err != nil {
		t.Fatal(err)
	}
	upload, err := a.uploadPath(workspace, local, remote+"/source.bin", false)
	if err != nil {
		t.Fatal(err)
	}
	sg1WorkflowInterruptTransfer(t, a, upload.ID)
	b := NewAppService(BuildInfo{Development: true}, nil)
	b.store = a.store
	b.transferEvent = func(Transfer) {}
	if err := b.RestoreTransferResumes(); err != nil {
		t.Fatal(err)
	}
	second := sg1WorkflowWorkspace(t, b, r)
	resumed, err := b.ResumeTransfer(upload.ID, second)
	if err != nil {
		t.Fatal(err)
	}
	sg1WorkflowWaitTransfer(t, b, resumed.ID, "done")
	if err := b.SetTransferRate(64); err != nil {
		t.Fatal(err)
	}
	downloadPath := filepath.Join(t.TempDir(), "download.bin")
	download, err := b.downloadPath(second, remote+"/source.bin", downloadPath, false)
	if err != nil {
		t.Fatal(err)
	}
	sg1WorkflowInterruptTransfer(t, b, download.ID)
	c := NewAppService(BuildInfo{Development: true}, nil)
	c.store = a.store
	c.transferEvent = func(Transfer) {}
	if err := c.RestoreTransferResumes(); err != nil {
		t.Fatal(err)
	}
	downloadWorkspace := sg1WorkflowWorkspace(t, c, r)
	resumedDownload, err := c.ResumeTransfer(download.ID, downloadWorkspace)
	if err != nil {
		t.Fatal(err)
	}
	sg1WorkflowWaitTransfer(t, c, resumedDownload.ID, "done")
	actual, err := os.ReadFile(downloadPath)
	if err != nil || !bytes.Equal(data, actual) {
		t.Fatal("恢复续传后的完整字节不一致")
	}
	sg1WorkflowCommand(t, b, second, "mkdir '"+remote+"/copy'")
	preview, err := b.PreviewRemoteDirectoryCopy(t.Context(), second, remote, second, remote+"/copy", nil)
	if err == nil {
		b.CancelDirectorySyncPreview(preview.ID)
		t.Fatal("允许同一远端重叠目录复制")
	}
	source := remote + "/src"
	target := remote + "/dst"
	sg1WorkflowCommand(t, b, second, fmt.Sprintf("mkdir '%s' '%s'; printf copy > '%s/data.txt'", source, target, source))
	preview, err = b.PreviewRemoteDirectoryCopy(t.Context(), workspace, source, second, target, nil)
	if err == nil {
		b.CancelDirectorySyncPreview(preview.ID)
		t.Fatal("允许其他服务实例的工作区")
	}
	third := sg1WorkflowWorkspace(t, b, r)
	preview, err = b.PreviewRemoteDirectoryCopy(t.Context(), third, source, second, target, nil)
	if err != nil {
		t.Fatal(err)
	}
	copyTask, err := b.ExecuteDirectorySync(preview.ID, []string{"data.txt"})
	if err != nil {
		t.Fatal(err)
	}
	sg1WorkflowWaitTransfer(t, b, copyTask.ID, "done")
	if sg1WorkflowCommand(t, b, second, "cat '"+target+"/data.txt'").Stdout != "copy" {
		t.Fatal("远端复制字节不一致")
	}
}
