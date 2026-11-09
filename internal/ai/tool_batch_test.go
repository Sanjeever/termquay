package ai

import (
	"encoding/json"
	"fmt"
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
