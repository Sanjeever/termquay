package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestMessagesSignedThinkingAndToolRoundTrip(t *testing.T) {
	var count atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != "synthetic" || r.Header.Get("anthropic-version") != "2023-06-01" {
			t.Error("Messages 认证头错误")
		}
		var body map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if count.Add(1) == 1 {
			sendEvents(w,
				`{"type":"message_start","message":{"usage":{"input_tokens":3}}}`,
				`{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}`,
				`{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"synthetic-thought"}}`,
				`{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"synthetic-signature"}}`,
				`{"type":"content_block_stop","index":0}`,
				`{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tool-a","name":"port_list","input":{}}}`,
				`{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{"}}`,
				`{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"}"}}`,
				`{"type":"content_block_stop","index":1}`,
				`{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":5}}`,
				`{"type":"message_stop"}`)
		} else {
			for _, field := range []string{"synthetic-signature", "synthetic-thought", `"tool_use_id":"tool-a"`, `"is_error":true`} {
				if !strings.Contains(string(body["messages"]), field) {
					t.Error("续接丢失 " + field)
				}
			}
			sendEvents(w, `{"type":"message_start","message":{}}`, `{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`, `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"完成"}}`, `{"type":"content_block_stop","index":0}`, `{"type":"message_delta","delta":{"stop_reason":"end_turn"}}`, `{"type":"message_stop"}`)
		}
	}))
	defer s.Close()
	c := NewClient(Config{Enabled: true, Protocol: "messages", Endpoint: s.URL, Model: "test", APIKey: "synthetic"})
	input := Request{Messages: []Message{{Role: "user", Content: "查询"}}}
	r, err := c.Stream(context.Background(), input, nil)
	if err != nil || len(r.Message.ToolCalls) != 1 || r.Message.ToolCalls[0].Arguments != "{}" || r.Usage.OutputTokens != 5 {
		t.Fatalf("Messages 拼接失败: %+v %v", r, err)
	}
	input.Messages = append(input.Messages, r.Message, Message{Role: "tool", ToolCallID: "tool-a", Content: "未执行", IsError: true})
	r, err = c.Stream(context.Background(), input, nil)
	if err != nil || r.Message.Content != "完成" {
		t.Fatalf("Messages 续接失败: %+v %v", r, err)
	}
}

func TestMessagesRejectIncompleteAndServerTools(t *testing.T) {
	for _, events := range [][]string{
		{`{"type":"message_start"}`, `{"type":"message_delta","delta":{"stop_reason":"max_tokens"}}`, `{"type":"message_stop"}`},
		{`{"type":"message_start"}`, `{"type":"content_block_start","index":0,"content_block":{"type":"server_tool_use"}}`},
		{`{"type":"error","error":{"message":"test-error"}}`},
	} {
		s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { sendEvents(w, events...) }))
		c := NewClient(Config{Enabled: true, Protocol: "messages", Endpoint: s.URL, Model: "test"})
		if _, err := c.Stream(context.Background(), Request{}, nil); err == nil {
			t.Error("接受错误或不完整回复")
		}
		s.Close()
	}
}
