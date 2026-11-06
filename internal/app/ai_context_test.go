package app

import (
	"context"
	"encoding/json"
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
		for _, m := range []ai.Message{{Role: "user", Content: strings.Repeat("data", 2048)}, {Role: "assistant", ToolCalls: []ai.ToolCall{{ID: "tool", Name: "port_list", Arguments: "{}"}}}, {Role: "tool", ToolCallID: "tool", Content: strings.Repeat("out", 1024)}} {
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
