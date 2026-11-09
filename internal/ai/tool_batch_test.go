package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestToolBatchProtocolLimits(t *testing.T) {
	for _, protocol := range []string{"chat_completions", "messages", "responses"} {
		for _, count := range []int{9, MaxToolCalls, MaxToolCalls + 1} {
			t.Run(fmt.Sprintf("%s/%d", protocol, count), func(t *testing.T) {
				var response Response
				var parse func(string) (bool, error)
				var events []any
				switch protocol {
				case "chat_completions":
					parse = chatParser(&response, nil)
					for i := range count {
						events = append(events, map[string]any{"choices": []any{map[string]any{"delta": map[string]any{"tool_calls": []any{map[string]any{"index": i, "id": fmt.Sprint(i), "function": map[string]any{"name": "port_list", "arguments": "{}"}}}}}}})
					}
					events = append(events, map[string]any{"choices": []any{map[string]any{"delta": map[string]any{}, "finish_reason": "tool_calls"}}})
				case "messages":
					parse = messagesParser(&response, nil)
					events = append(events, map[string]any{"type": "message_start"})
					for i := range count {
						events = append(events, map[string]any{"type": "content_block_start", "index": i, "content_block": map[string]any{"type": "tool_use", "id": fmt.Sprint(i), "name": "port_list", "input": map[string]any{}}}, map[string]any{"type": "content_block_stop", "index": i})
					}
					events = append(events, map[string]any{"type": "message_delta", "delta": map[string]any{"stop_reason": "tool_use"}}, map[string]any{"type": "message_stop"})
				case "responses":
					parse = responsesParser(&response, nil)
					output := []any{}
					for i := range count {
						events = append(events, map[string]any{"type": "response.function_call_arguments.delta", "output_index": i, "delta": "{}"})
						output = append(output, map[string]any{"type": "function_call", "call_id": fmt.Sprint(i), "name": "port_list", "arguments": "{}"})
					}
					events = append(events, map[string]any{"type": "response.completed", "response": map[string]any{"status": "completed", "output": output}})
				}
				var err error
				for _, event := range events {
					encoded, marshalErr := json.Marshal(event)
					if marshalErr != nil {
						t.Fatal(marshalErr)
					}
					if _, err = parse(string(encoded)); err != nil {
						break
					}
				}
				if (err != nil) != (count > MaxToolCalls) {
					t.Fatalf("calls=%d: %v", count, err)
				}
				if err == nil && len(response.Message.ToolCalls) != count {
					t.Fatalf("lost calls: %d of %d", len(response.Message.ToolCalls), count)
				}
			})
		}
	}
}

func TestTextOnlyRequestsDisableAndRejectTools(t *testing.T) {
	for _, protocol := range []string{"chat_completions", "messages", "responses"} {
		for _, tool := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/tool=%t", protocol, tool), func(t *testing.T) {
				s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					var body map[string]json.RawMessage
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Error(err)
						return
					}
					choice := `"none"`
					if protocol == "messages" {
						choice = `{"type":"none"}`
					}
					if string(body["tool_choice"]) != choice || len(body["tools"]) != 0 {
						t.Error("text-only request advertised tools")
					}
					switch protocol {
					case "chat_completions":
						if tool {
							sendEvents(w, `{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call","function":{"name":"exec","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}`, `[DONE]`)
						} else {
							sendEvents(w, `{"choices":[{"delta":{"content":"summary"},"finish_reason":"stop"}]}`, `[DONE]`)
						}
					case "messages":
						block, reason := `{"type":"text","text":"summary"}`, "end_turn"
						if tool {
							block, reason = `{"type":"tool_use","id":"call","name":"exec","input":{}}`, "tool_use"
						}
						sendEvents(w, `{"type":"message_start"}`, `{"type":"content_block_start","index":0,"content_block":`+block+`}`, `{"type":"content_block_stop","index":0}`, `{"type":"message_delta","delta":{"stop_reason":"`+reason+`"}}`, `{"type":"message_stop"}`)
					case "responses":
						if tool {
							sendEvents(w, `{"type":"response.completed","response":{"status":"completed","output":[{"type":"function_call","call_id":"call","name":"exec","arguments":"{}"}]}}`)
						} else {
							sendEvents(w, `{"type":"response.output_text.delta","delta":"summary"}`, `{"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"summary"}]}]}}`)
						}
					}
				}))
				defer s.Close()
				c := NewClient(Config{Enabled: true, Protocol: protocol, Endpoint: s.URL, Model: "test"})
				defer c.Close()
				response, err := c.Stream(context.Background(), Request{TextOnly: true}, nil)
				if (err != nil) != tool || !tool && response.Message.Content != "summary" {
					t.Fatalf("text-only response: %+v, err=%v", response, err)
				}
			})
		}
	}
}
