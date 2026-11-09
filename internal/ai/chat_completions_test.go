package ai

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
)

func sendEvents(w http.ResponseWriter, events ...string) {
	w.Header().Set("Content-Type", "text/event-stream")
	for _, e := range events {
		for _, part := range []string{"data: ", e, "\r\n\r\n"} {
			_, _ = fmt.Fprint(w, part)
			w.(http.Flusher).Flush()
		}
	}
}

func TestChatStreamingToolRoundTrip(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer synthetic-key" {
			t.Error("认证头错误")
		}
		var body map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if requests.Add(1) == 1 {
			sendEvents(w, `{"choices":[{"delta":{"content":"先查"}}]}`, `{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-a","function":{"name":"file_list","arguments":"{\"path\":"}}]}}]}`, `{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"/tmp\"}"}}]},"finish_reason":"tool_calls"}]}`, `[DONE]`)
		} else {
			if !strings.Contains(string(body["messages"]), `"tool_call_id":"call-a"`) || !strings.Contains(string(body["messages"]), `"arguments":"{\"path\":\"/tmp\"}"`) {
				t.Errorf("工具续接丢失: %s", body["messages"])
			}
			sendEvents(w, `{"choices":[{"delta":{"content":"完成"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2}}`, `[DONE]`)
		}
	}))
	defer server.Close()
	c := NewClient(Config{Enabled: true, Protocol: "chat_completions", Endpoint: server.URL, Model: "test", APIKey: "synthetic-key"})
	input := Request{System: "测试", Messages: []Message{{Role: "user", Content: "查询"}}, Tools: []Tool{{Name: "file_list", Parameters: json.RawMessage(`{"type":"object"}`)}}}
	var text strings.Builder
	response, err := c.Stream(context.Background(), input, func(s string) error { text.WriteString(s); return nil })
	if err != nil || text.String() != "先查" || len(response.Message.ToolCalls) != 1 || response.Message.ToolCalls[0].Arguments != `{"path":"/tmp"}` {
		t.Fatalf("流式调用错误: %+v %v", response, err)
	}
	input.Messages = append(input.Messages, response.Message, Message{Role: "tool", ToolCallID: "call-a", Content: `{"entries":[]}`})
	response, err = c.Stream(context.Background(), input, nil)
	if err != nil || response.Message.Content != "完成" || response.Usage.InputTokens != 10 {
		t.Fatalf("续接错误: %+v %v", response, err)
	}
}

func TestChatErrorsLimitsAndCancellation(t *testing.T) {
	for _, tt := range []struct {
		name   string
		events []string
	}{
		{"incomplete", []string{`{"choices":[{"delta":{"content":"partial"}}]}`}},
		{"invalid_arguments", []string{`{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"x","function":{"name":"exec","arguments":"{"}}]},"finish_reason":"tool_calls"}]}`, `[DONE]`}},
		{"truncated", []string{`{"choices":[{"delta":{},"finish_reason":"length"}]}`, `[DONE]`}},
		{"too_many_calls", []string{fmt.Sprintf(`{"choices":[{"delta":{"tool_calls":[{"index":%d,"id":"x"}]}}]}`, MaxToolCalls)}},
		{"negative_index", []string{`{"choices":[{"delta":{"tool_calls":[{"index":-1,"id":"x"}]}}]}`}},
		{"provider_error", []string{`{"error":{"message":"synthetic-key"}}`}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { sendEvents(w, tt.events...) }))
			defer s.Close()
			c := NewClient(Config{Enabled: true, Protocol: "chat_completions", Endpoint: s.URL, Model: "test", APIKey: "synthetic-key"})
			_, err := c.Stream(context.Background(), Request{}, nil)
			if err == nil || strings.Contains(err.Error(), "synthetic-key") {
				t.Fatalf("错误未暴露或 Key 泄露: %v", err)
			}
		})
	}
	t.Run("cancel", func(t *testing.T) {
		s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/event-stream")
			w.(http.Flusher).Flush()
			<-r.Context().Done()
		}))
		defer s.Close()
		c := NewClient(Config{Enabled: true, Protocol: "chat_completions", Endpoint: s.URL, Model: "test"})
		ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
		defer cancel()
		if _, err := c.Stream(ctx, Request{}, nil); err == nil {
			t.Fatal("取消未传递")
		}
	})
}
