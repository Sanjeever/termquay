package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Sanjeever/termquay/internal/ai"
)

func TestAIExecWithoutApprovalAndWorkspaceIsolation(t *testing.T) {
	a, executed := aiTestSSH(t)
	var count atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if count.Add(1) == 1 {
			aiTestCall(w, "auto", "printf automatic")
		} else {
			aiTestReply(w)
		}
	}))
	defer s.Close()
	aiTestConfigure(t, a, s.URL, false)
	start := aiTestStart(t, a)
	v := waitAI(t, a, func(v AIRunView) bool { return v.State == "complete" || v.State == "failed" })
	if v.State != "complete" {
		t.Fatal(v.Error)
	}
	select {
	case <-executed:
	case <-time.After(time.Second):
		t.Fatal("关闭确认后未执行")
	}
	a.mu.Lock()
	other := *a.workspaces["workspace"]
	a.workspaces["other"] = &other
	a.mu.Unlock()
	c, err := a.CreateAIConversation(context.Background(), "other")
	if err != nil {
		t.Fatal(err)
	}
	if c.ID == start.ConversationID {
		t.Fatal("多工作区共享当前对话")
	}
	if err := a.OpenAIConversation(context.Background(), "other", start.ConversationID); err == nil {
		t.Fatal("抢占其他工作区当前对话")
	}
	other.connectionID = "different"
	if _, err := a.GetAIConversation(context.Background(), "other", start.ConversationID, 0, 24); err == nil {
		t.Fatal("跨连接读取历史")
	}
	if _, err := a.StartAIRun(context.Background(), AIStartRequest{Workspace: "", ConversationID: start.ConversationID, Text: "test"}); err == nil {
		t.Fatal("空工作区回落")
	}
	a.mu.Lock()
	delete(a.workspaces, "other")
	a.mu.Unlock()
}

func TestAICompactionPreservesLocalHistoryAndCompleteToolPairs(t *testing.T) {
	a, _ := aiTestSSH(t)
	var summaries atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		summaries.Add(1)
		aiTestEvents(w, map[string]any{"choices": []any{map[string]any{"delta": map[string]any{"content": "合成摘要，先前工具已完成，未批准其他操作"}, "finish_reason": "stop"}}})
	}))
	defer s.Close()
	aiTestConfigure(t, a, s.URL, true)
	c, err := a.CreateAIConversation(context.Background(), "workspace")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	run := &aiRun{ctx: ctx, view: AIRunView{ID: "test", Workspace: "workspace", ConversationID: c.ID}}
	for i := 0; i < 18; i++ {
		for _, m := range []ai.Message{{Role: "user", Content: strings.Repeat("data", 2048)}, {Role: "assistant", ToolCalls: []ai.ToolCall{{ID: "tool", Name: "port_list", Arguments: "{}"}}}, {Role: "tool", ToolCallID: "tool", Content: `{"data":"` + strings.Repeat("out", 1024) + `"}`}} {
			if _, err := a.persistAIMessage(run, m, "complete"); err != nil {
				t.Fatal(err)
			}
		}
	}
	config, err := a.aiConfig()
	if err != nil {
		t.Fatal(err)
	}
	messages, summary, err := a.aiRunContext(ctx, run, ai.NewClient(config))
	if err != nil {
		t.Fatal(err)
	}
	if summary == "" || summaries.Load() == 0 || !run.snapshot().Compressed {
		t.Fatal("长上下文未压缩")
	}
	pending := map[string]bool{}
	for _, m := range messages {
		if m.Role == "assistant" {
			for _, call := range m.ToolCalls {
				pending[call.ID] = true
			}
		}
		if m.Role == "tool" {
			if !pending[m.ToolCallID] {
				t.Fatal("压缩拆开工具往返")
			}
			delete(pending, m.ToolCallID)
		}
	}
	a.storeMu.Lock()
	all, err := a.store.AIMessages(context.Background(), c.ID, 0, 100)
	a.storeMu.Unlock()
	if err != nil || len(all) != 54 {
		t.Fatal("压缩删除了本机完整历史")
	}
	page, err := a.GetAIConversation(context.Background(), "workspace", c.ID, 0, 24)
	if err != nil {
		t.Fatal(err)
	}
	if page.Conversation.SummaryThrough == 0 || !page.HasMore {
		t.Fatal("压缩状态或分页丢失")
	}
}

func TestAIContextRetainsLargeToolBatch(t *testing.T) {
	a, _ := aiTestSSH(t)
	aiTestConfigure(t, a, "http://127.0.0.1:1", false)
	c, err := a.CreateAIConversation(t.Context(), "workspace")
	if err != nil {
		t.Fatal(err)
	}
	run := &aiRun{ctx: t.Context(), view: AIRunView{ID: "batch", Workspace: "workspace", ConversationID: c.ID}}
	calls := make([]ai.ToolCall, ai.MaxToolCalls)
	for i := range calls {
		calls[i] = ai.ToolCall{ID: fmt.Sprint(i), Name: "port_list", Arguments: "{}"}
	}
	if _, err := a.persistAIMessage(run, ai.Message{Role: "assistant", ToolCalls: calls}, "complete"); err != nil {
		t.Fatal(err)
	}
	for _, call := range calls {
		if _, err := a.persistAIMessage(run, ai.Message{Role: "tool", ToolCallID: call.ID, Content: `{}`}, "complete"); err != nil {
			t.Fatal(err)
		}
	}
	if err := a.repairAITail(run); err != nil {
		t.Fatal(err)
	}
	client := ai.NewClient(ai.DefaultConfig())
	defer client.Close()
	messages, _, err := a.aiRunContext(t.Context(), run, client)
	if err != nil || len(messages) != len(calls)+1 {
		t.Fatalf("incomplete batch: messages=%d, err=%v", len(messages), err)
	}
}

func TestAIContextFailureAndInterruptedToolRepair(t *testing.T) {
	a, _ := aiTestSSH(t)
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":{"message":"synthetic failure"}}`, 503)
	}))
	defer s.Close()
	aiTestConfigure(t, a, s.URL, true)
	c, err := a.CreateAIConversation(context.Background(), "workspace")
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	run := &aiRun{ctx: ctx, view: AIRunView{ID: "test", Workspace: "workspace", ConversationID: c.ID}}
	for i := 0; i < 20; i++ {
		if _, err := a.persistAIMessage(run, ai.Message{Role: "user", Content: strings.Repeat("x", 12<<10)}, "complete"); err != nil {
			t.Fatal(err)
		}
	}
	config, _ := a.aiConfig()
	if _, _, err := a.aiRunContext(ctx, run, ai.NewClient(config)); err == nil {
		t.Fatal("压缩失败被吞掉")
	}
	a.storeMu.Lock()
	after, err := a.store.AIConversation(ctx, c.ID)
	a.storeMu.Unlock()
	if err != nil || after.SummaryThrough != 0 {
		t.Fatal("压缩失败仍丢弃上下文")
	}
	if _, err := a.persistAIMessage(run, ai.Message{Role: "assistant", ToolCalls: []ai.ToolCall{{ID: "interrupted", Name: "exec", Arguments: `{"script":"echo","timeout_seconds":10}`}}}, "complete"); err != nil {
		t.Fatal(err)
	}
	if err := a.repairAITail(run); err != nil {
		t.Fatal(err)
	}
	page, err := a.GetAIConversation(ctx, "workspace", c.ID, 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	if page.Messages[0].Message.ToolCallID != "interrupted" || page.Messages[0].State != "interrupted" {
		t.Fatal("历史中断工具未标注")
	}
}

func TestAIConnectionProbeSeparatesTextAndTools(t *testing.T) {
	a, _ := aiTestSSH(t)
	var count atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if strings.Contains(string(body["messages"]), "synthetic-user") || strings.Contains(string(body["messages"]), "workspace") {
			t.Error("测试连接包含工作区信息")
		}
		if count.Add(1) == 1 {
			aiTestReply(w)
		} else {
			aiTestCall(w, "wrong", "printf should-not-run")
		}
	}))
	defer s.Close()
	u := AISettingsUpdate{Enabled: true, Protocol: "chat_completions", Endpoint: s.URL, Model: "test", APIKeyAction: "clear", ConfirmExec: true}
	r, err := a.TestAIConnection(context.Background(), u)
	if err != nil || !r.Reply.OK || r.Tools.OK || r.Tools.Error == "" {
		t.Fatalf("未分别呈现工具失败: %+v %v", r, err)
	}
	settings, err := a.GetAISettings()
	if err != nil || settings.Enabled {
		t.Fatal("测试连接修改了配置")
	}
}

func TestAITemporaryHistoryCanBeOpenedAfterReconnect(t *testing.T) {
	a, _ := aiTestSSH(t)
	aiTestConfigure(t, a, "https://example.invalid/chat", true)
	a.workspaces["workspace"].connectionID = ""
	old, err := a.CreateAIConversation(context.Background(), "workspace")
	if err != nil {
		t.Fatal(err)
	}
	a.closeAIWorkspace("workspace")
	a.mu.Lock()
	replacement := *a.workspaces["workspace"]
	delete(a.workspaces, "workspace")
	a.workspaces["reconnected"] = &replacement
	a.mu.Unlock()
	current, err := a.CreateAIConversation(context.Background(), "reconnected")
	if err != nil {
		t.Fatal(err)
	}
	if current.ID == old.ID || current.Archive == old.Archive {
		t.Fatal("临时工作区合并了归档身份")
	}
	list, err := a.ListAIConversations(context.Background(), "reconnected", 0, 10)
	if err != nil || len(list) != 2 {
		t.Fatalf("重新连接无法查阅临时历史: %v", err)
	}
	if err := a.OpenAIConversation(context.Background(), "reconnected", old.ID); err != nil {
		t.Fatal(err)
	}
	replacement.target = "different@example.invalid:22"
	if _, err := a.GetAIConversation(context.Background(), "reconnected", old.ID, 0, 1); err == nil {
		t.Fatal("其他临时目标可读取历史")
	}
}

func TestAIChangedTargetNeedsExplicitContinuation(t *testing.T) {
	a, _ := aiTestSSH(t)
	var system string
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Messages []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		for _, m := range body.Messages {
			if m.Role == "system" {
				system = m.Content
			}
		}
		aiTestReply(w)
	}))
	defer s.Close()
	aiTestConfigure(t, a, s.URL, true)
	c, err := a.CreateAIConversation(context.Background(), "workspace")
	if err != nil {
		t.Fatal(err)
	}
	a.closeAIWorkspace("workspace")
	a.mu.Lock()
	replacement := *a.workspaces["workspace"]
	replacement.target = "changed@example.invalid:22"
	a.workspaces["workspace"] = &replacement
	a.mu.Unlock()
	if err := a.OpenAIConversation(context.Background(), "workspace", c.ID); err != nil {
		t.Fatal(err)
	}
	r := AIStartRequest{Workspace: "workspace", ConversationID: c.ID, Text: "继续"}
	if _, err := a.StartAIRun(context.Background(), r); err == nil {
		t.Fatal("未核对变化目标仍继续")
	}
	r.AcceptTargetChange = true
	if _, err := a.StartAIRun(context.Background(), r); err != nil {
		t.Fatal(err)
	}
	a.aiMu.Lock()
	run := a.aiRuns["workspace"]
	a.aiMu.Unlock()
	select {
	case <-run.done:
	case <-time.After(5 * time.Second):
		t.Fatal("轮次未完成")
	}
	if !strings.Contains(system, c.Target) || !strings.Contains(system, replacement.target) {
		t.Fatal("模型未区分原目标和当前目标")
	}
}

func TestAIStorageFailureStopsToolsAndReportsOnShutdown(t *testing.T) {
	a, executed := aiTestSSH(t)
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		a.storeMu.Lock()
		a.store.Close()
		a.storeMu.Unlock()
		aiTestCall(w, "persist-failure", "printf must-not-run")
	}))
	defer s.Close()
	aiTestConfigure(t, a, s.URL, false)
	aiTestStart(t, a)
	a.aiMu.Lock()
	run := a.aiRuns["workspace"]
	a.aiMu.Unlock()
	select {
	case <-run.done:
	case <-time.After(5 * time.Second):
		t.Fatal("存储失败未停止")
	}
	if view := run.snapshot(); view.State != "failed" || !strings.Contains(view.Error, "保存失败") {
		t.Fatalf("存储失败显示成功: %+v", view)
	}
	select {
	case <-executed:
		t.Fatal("助手消息未保存仍执行工具")
	default:
	}
	if err := a.shutdownAI(); err == nil {
		t.Fatal("退出未报告历史保存失败")
	}
}
