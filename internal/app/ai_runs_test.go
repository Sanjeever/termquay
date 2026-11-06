package app

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Sanjeever/termquay/internal/ai"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"github.com/wailsapp/wails/v3/pkg/application"
	gossh "golang.org/x/crypto/ssh"
)

func aiTestSSH(t *testing.T) (*AppService, <-chan string) {
	t.Helper()
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
	t.Cleanup(func() { listener.Close() })
	executed := make(chan string, 32)
	go func() {
		raw, err := listener.Accept()
		if err != nil {
			return
		}
		conn, channels, requests, err := gossh.NewServerConn(raw, config)
		if err != nil {
			raw.Close()
			return
		}
		defer conn.Close()
		go gossh.DiscardRequests(requests)
		for next := range channels {
			if next.ChannelType() != "session" {
				next.Reject(gossh.UnknownChannelType, "session only")
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
					case "exec":
						request.Reply(true, nil)
						b, err := io.ReadAll(io.LimitReader(channel, 33<<10))
						if err != nil {
							return
						}
						executed <- string(b)
						if strings.Contains(string(b), "unknown_fixture") {
							return
						}
						fmt.Fprint(channel, "synthetic-output")
						channel.SendRequest("exit-status", false, gossh.Marshal(struct{ Status uint32 }{0}))
						return
					default:
						request.Reply(false, nil)
					}
				}
			}()
		}
	}()
	ctx, cancel := context.WithCancel(context.Background())
	term, err := terminal.Dial(ctx, terminal.Request{Host: "127.0.0.1", Port: listener.Addr().(*net.TCPAddr).Port, Username: "synthetic-user", Password: "synthetic-password", Fingerprint: gossh.FingerprintSHA256(signer.PublicKey()), Cols: 80, Rows: 24})
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	a := NewAppService(BuildInfo{}, nil)
	if err := a.UseSessionStorage(); err != nil {
		term.Disconnect()
		cancel()
		t.Fatal(err)
	}
	a.workspaces["workspace"] = &workspaceOwner{connectionID: "saved", target: "synthetic-user@127.0.0.1:22", ctx: ctx, cancel: cancel, terminal: term, timer: time.NewTimer(time.Hour)}
	t.Cleanup(func() { a.ServiceShutdown() })
	return a, executed
}

func aiTestEvents(w http.ResponseWriter, events ...any) {
	w.Header().Set("Content-Type", "text/event-stream")
	for _, e := range events {
		b, _ := json.Marshal(e)
		fmt.Fprintf(w, "data: %s\n\n", b)
		w.(http.Flusher).Flush()
	}
	fmt.Fprint(w, "data: [DONE]\n\n")
	w.(http.Flusher).Flush()
}

func aiTestCall(w http.ResponseWriter, id, script string) {
	args, _ := json.Marshal(map[string]any{"script": script, "timeout_seconds": 10})
	aiTestEvents(w, map[string]any{"choices": []any{map[string]any{"delta": map[string]any{"tool_calls": []any{map[string]any{"index": 0, "id": id, "function": map[string]any{"name": "exec", "arguments": string(args)}}}}, "finish_reason": "tool_calls"}}})
}

func aiTestReply(w http.ResponseWriter) {
	aiTestEvents(w, map[string]any{"choices": []any{map[string]any{"delta": map[string]any{"content": "完成"}, "finish_reason": "stop"}}})
}

func aiTestConfigure(t *testing.T, a *AppService, url string, confirm bool) {
	t.Helper()
	if _, err := a.SaveAISettings(AISettingsUpdate{Enabled: true, Protocol: "chat_completions", Endpoint: url, Model: "test", APIKeyAction: "replace", APIKey: "synthetic-key", ConfirmExec: confirm}); err != nil {
		t.Fatal(err)
	}
}

func aiTestStart(t *testing.T, a *AppService) AIRunView {
	t.Helper()
	c, err := a.CreateAIConversation(context.Background(), "workspace")
	if err != nil {
		t.Fatal(err)
	}
	run, err := a.StartAIRun(context.Background(), AIStartRequest{Workspace: "workspace", ConversationID: c.ID, Text: "测试"})
	if err != nil {
		t.Fatal(err)
	}
	return run
}

func waitAI(t *testing.T, a *AppService, predicate func(AIRunView) bool) AIRunView {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		v, err := a.GetAIRun("workspace")
		if err != nil {
			t.Fatal(err)
		}
		if predicate(v) {
			return v
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("等待 AI 状态超时")
	return AIRunView{}
}

func decisionFor(v AIRunView) AIToolDecision {
	return AIToolDecision{Workspace: v.Workspace, RunID: v.ID, ConversationID: v.ConversationID, Token: v.Pending.Token, CallID: v.Pending.Call.ID, Arguments: v.Pending.Call.Arguments, TimeoutSeconds: v.Pending.TimeoutSeconds}
}

func TestAIRunApprovalAndRealLocalSSHChannel(t *testing.T) {
	a, executed := aiTestSSH(t)
	var count atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		if strings.Contains(string(b), "synthetic-password") {
			t.Error("SSH 密码进入模型上下文")
		}
		if count.Add(1) == 1 {
			aiTestCall(w, "call-a", "printf test")
		} else {
			aiTestReply(w)
		}
	}))
	defer s.Close()
	aiTestConfigure(t, a, s.URL, true)
	aiTestStart(t, a)
	v := waitAI(t, a, func(v AIRunView) bool { return v.Pending != nil })
	select {
	case <-executed:
		t.Fatal("未批准已执行")
	default:
	}
	d := decisionFor(v)
	forged := d
	forged.Arguments = `{"script":"other","timeout_seconds":10}`
	if err := a.ApproveAIToolCall(forged); err == nil {
		t.Fatal("接受篡改参数")
	}
	if err := a.ApproveAIToolCall(d); err != nil {
		t.Fatal(err)
	}
	if err := a.ApproveAIToolCall(d); err == nil {
		t.Fatal("重复批准未失效")
	}
	v = waitAI(t, a, func(v AIRunView) bool { return v.State == "complete" || v.State == "failed" })
	if v.State != "complete" {
		t.Fatal(v.Error)
	}
	select {
	case script := <-executed:
		if script != "printf test" {
			t.Fatal("执行参数变化")
		}
	case <-time.After(time.Second):
		t.Fatal("未执行批准命令")
	}
	page, err := a.GetAIConversation(context.Background(), "workspace", v.ConversationID, 0, 24)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Messages) != 5 || page.Messages[2].Message.Role != "tool" || page.Messages[2].Result == nil || page.Messages[2].Result.ExitCode == nil || *page.Messages[2].Result.ExitCode != 0 {
		t.Fatalf("历史缺少工具结果: %+v", page.Messages)
	}
}

func TestAIRejectedScriptDoesNotRetry(t *testing.T) {
	a, executed := aiTestSSH(t)
	var count atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if n := count.Add(1); n <= 2 {
			aiTestCall(w, fmt.Sprint(n), "printf rejected")
		} else {
			aiTestReply(w)
		}
	}))
	defer s.Close()
	aiTestConfigure(t, a, s.URL, true)
	aiTestStart(t, a)
	v := waitAI(t, a, func(v AIRunView) bool { return v.Pending != nil })
	if err := a.RejectAIToolCall(decisionFor(v)); err != nil {
		t.Fatal(err)
	}
	v = waitAI(t, a, func(v AIRunView) bool { return v.State == "complete" })
	select {
	case <-executed:
		t.Fatal("执行了被拒绝脚本")
	default:
	}
	page, err := a.GetAIConversation(context.Background(), "workspace", v.ConversationID, 0, 24)
	if err != nil {
		t.Fatal(err)
	}
	rejected := 0
	for _, m := range page.Messages {
		if m.State == "rejected" {
			rejected++
		}
	}
	if rejected != 2 {
		t.Fatal("拒绝或阻止自动重试没有留存")
	}
}

func TestAILifecycleInvalidatesApproval(t *testing.T) {
	application.New(application.Options{})
	for _, action := range []string{"stop", "disable", "lock", "system_lock", "disconnect", "replace_owner", "delete", "new", "shutdown"} {
		t.Run(action, func(t *testing.T) {
			a, executed := aiTestSSH(t)
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { aiTestCall(w, "call-a", "printf forbidden") }))
			defer s.Close()
			aiTestConfigure(t, a, s.URL, true)
			start := aiTestStart(t, a)
			v := waitAI(t, a, func(v AIRunView) bool { return v.Pending != nil })
			d := decisionFor(v)
			a.aiMu.Lock()
			run := a.aiRuns["workspace"]
			a.aiMu.Unlock()
			switch action {
			case "stop":
				if err := a.StopAIRun("workspace", v.ID); err != nil {
					t.Fatal(err)
				}
			case "disable":
				if _, err := a.SaveAISettings(AISettingsUpdate{Protocol: "chat_completions", Endpoint: s.URL, Model: "test", APIKeyAction: "keep", ConfirmExec: true}); err != nil {
					t.Fatal(err)
				}
			case "lock", "system_lock":
				a.lockState.Available = true
				a.lockState.LockOnSystem = true
				if action == "lock" {
					if err := a.LockApplication(); err != nil {
						t.Fatal(err)
					}
				} else {
					a.lockForSystem()
				}
			case "disconnect":
				a.workspaces["workspace"].cancel()
			case "replace_owner":
				old := a.workspaces["workspace"]
				replacement := *old
				a.mu.Lock()
				a.workspaces["workspace"] = &replacement
				a.mu.Unlock()
				if err := a.ApproveAIToolCall(d); err == nil {
					t.Fatal("重连后旧批准有效")
				}
				run.cancel()
			case "delete":
				if err := a.DeleteAIConversation(context.Background(), "workspace", v.ConversationID); err != nil {
					t.Fatal(err)
				}
			case "new":
				if _, err := a.CreateAIConversation(context.Background(), "workspace"); err != nil {
					t.Fatal(err)
				}
			case "shutdown":
				a.shutdownAI()
			}
			select {
			case <-run.done:
			case <-time.After(5 * time.Second):
				t.Fatal("取消未结束")
			}
			if err := a.ApproveAIToolCall(d); err == nil {
				t.Fatal("接受过期批准")
			}
			select {
			case <-executed:
				t.Fatal("生命周期结束后执行命令")
			default:
			}
			if action == "delete" {
				a.storeMu.Lock()
				_, err := a.store.AIConversation(context.Background(), start.ConversationID)
				a.storeMu.Unlock()
				if err == nil {
					t.Fatal("删除后历史被重建")
				}
			}
		})
	}
}

func TestAIToolBoundary(t *testing.T) {
	if len(aiTools) != 10 {
		t.Fatal("工具集变化")
	}
	for _, tool := range aiTools {
		if _, err := validateAITool(ai.ToolCall{Name: tool.Name, Arguments: `{"workspace":"other"}`}); err == nil {
			t.Fatal("工具可选择工作区")
		}
	}
	for _, call := range []ai.ToolCall{{Name: "file_list", Arguments: `{"path":""}`}, {Name: "file_read", Arguments: `{"path":"relative"}`}, {Name: "exec", Arguments: `{"script":"ls","timeout_seconds":0}`}, {Name: "file_write", Arguments: `{}`}, {Name: "port_list", Arguments: `null`}} {
		if _, err := validateAITool(call); err == nil {
			t.Fatal("接受无效工具参数")
		}
	}
}

func TestAIUnknownRemoteCommandIsNotReplayed(t *testing.T) {
	a, executed := aiTestSSH(t)
	var count atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if n := count.Add(1); n <= 2 {
			aiTestCall(w, fmt.Sprint(n), "printf unknown_fixture")
		} else {
			aiTestReply(w)
		}
	}))
	defer s.Close()
	aiTestConfigure(t, a, s.URL, false)
	aiTestStart(t, a)
	waitAI(t, a, func(v AIRunView) bool { return v.State == "complete" })
	if len(executed) != 1 {
		t.Fatal("状态未知的远端命令被自动重放")
	}
}

func TestAIToolOutputKeepsStderrWhenStdoutIsTruncated(t *testing.T) {
	r, state := boundedAIToolResult(terminal.CommandResult{Stdout: strings.Repeat("x", 80<<10), Stderr: "synthetic-important-error", ExitCode: 17}, nil)
	if state != "failed" || !r.Truncated || r.Stderr != "synthetic-important-error" || r.ExitCode == nil || *r.ExitCode != 17 || len(r.Data)+len(r.Stderr) > maxAIToolResultBytes {
		t.Fatal("标准输出截断丢失错误输出或退出状态")
	}
	r, _ = boundedAIToolResult(terminal.CommandResult{}, context.Canceled)
	if r.ExitCode != nil {
		t.Fatal("未执行的命令报告退出码 0")
	}
}

func TestAIRunBudgetPausesForApproval(t *testing.T) {
	ctx, cancel := context.WithCancelCause(context.Background())
	defer cancel(context.Canceled)
	run := &aiRun{ctx: ctx, cancelCause: cancel, budgetRemaining: 80 * time.Millisecond, approval: make(chan bool, 1)}
	run.mu.Lock()
	run.resumeBudgetLocked()
	run.budgetStartedAt = time.Now().Add(-20 * time.Millisecond)
	run.pauseBudgetLocked()
	remaining := run.budgetRemaining
	run.mu.Unlock()
	if remaining >= 80*time.Millisecond || remaining <= 0 {
		t.Fatal("暂停没有扣除已用运行预算")
	}
	a := NewAppService(BuildInfo{}, nil)
	result := make(chan error, 1)
	go func() {
		_, err := a.awaitAIApproval(ctx, run, ai.ToolCall{ID: "budget", Name: "exec", Arguments: `{"script":"true","timeout_seconds":10}`}, 10)
		result <- err
	}()
	time.Sleep(100 * time.Millisecond)
	if ctx.Err() != nil {
		t.Fatal("等待批准消耗了运行预算")
	}
	run.approval <- false
	select {
	case err := <-result:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("批准等待没有结束")
	}
	select {
	case <-ctx.Done():
		if !errors.Is(context.Cause(ctx), errAIRunTimeout) {
			t.Fatal("轮次超时原因丢失")
		}
	case <-time.After(time.Second):
		t.Fatal("批准后没有恢复剩余运行预算")
	}
}
