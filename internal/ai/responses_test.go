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

func TestResponsesEncryptedReasoningAndToolRoundTrip(t *testing.T) {
	var count atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if string(body["store"]) != "false" || !strings.Contains(string(body["include"]), "reasoning.encrypted_content") {
			t.Error("未启用无状态加密续接")
		}
		if count.Add(1) == 1 {
			sendEvents(w, `{"type":"response.function_call_arguments.delta","output_index":1,"delta":"{"}`, `{"type":"response.function_call_arguments.delta","output_index":1,"delta":"}"}`, `{"type":"response.completed","response":{"status":"completed","output":[{"id":"rs-a","type":"reasoning","encrypted_content":"synthetic-encrypted-state","summary":[]},{"id":"fc-a","type":"function_call","call_id":"call-a","name":"port_list","arguments":"{}"}],"usage":{"input_tokens":4,"output_tokens":8}}}`)
		} else {
			for _, field := range []string{"synthetic-encrypted-state", `"call_id":"call-a"`, `"type":"function_call_output"`} {
				if !strings.Contains(string(body["input"]), field) {
					t.Error("续接丢失 " + field)
				}
			}
			sendEvents(w, `{"type":"response.output_text.delta","delta":"完"}`, `{"type":"response.output_text.delta","delta":"成"}`, `{"type":"response.completed","response":{"status":"completed","output":[{"id":"m-a","type":"message","role":"assistant","content":[{"type":"output_text","text":"完成","annotations":[]}]}]}}`)
		}
	}))
	defer s.Close()
	c := NewClient(Config{Enabled: true, Protocol: "responses", Endpoint: s.URL, Model: "test"})
	input := Request{Messages: []Message{{Role: "user", Content: "查询"}}}
	r, err := c.Stream(context.Background(), input, nil)
	if err != nil || len(r.Message.ToolCalls) != 1 || r.Message.ToolCalls[0].ID != "call-a" || r.Usage.OutputTokens != 8 {
		t.Fatalf("Responses 工具调用失败: %+v %v", r, err)
	}
	input.Messages = append(input.Messages, r.Message, Message{Role: "tool", ToolCallID: "call-a", Content: "[]"})
	r, err = c.Stream(context.Background(), input, nil)
	if err != nil || r.Message.Content != "完成" {
		t.Fatalf("Responses 续接失败: %+v %v", r, err)
	}
}

func TestResponsesErrorsAndMismatch(t *testing.T) {
	for _, event := range []string{
		`{"type":"response.failed","response":{"error":{"message":"failed"}}}`,
		`{"type":"response.incomplete","response":{"status":"incomplete"}}`,
		`{"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"missing-delta"}]}]}}`,
		`{"type":"response.completed","response":{"status":"completed","output":[{"type":"web_search_call"}]}}`,
	} {
		s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { sendEvents(w, event) }))
		c := NewClient(Config{Enabled: true, Protocol: "responses", Endpoint: s.URL, Model: "test"})
		if _, err := c.Stream(context.Background(), Request{}, nil); err == nil {
			t.Error("接受不完整回复或远端工具")
		}
		s.Close()
	}
}
