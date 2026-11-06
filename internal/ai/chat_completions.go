package ai

import (
	"encoding/json"
	"errors"
)

func chatRequest(c Config, r Request) any {
	messages := []any{map[string]any{"role": "system", "content": r.System}}
	for _, m := range r.Messages {
		item := map[string]any{"role": m.Role, "content": m.ModelContent()}
		if len(m.ToolCalls) > 0 {
			calls := []any{}
			for _, t := range m.ToolCalls {
				calls = append(calls, map[string]any{"id": t.ID, "type": "function", "function": map[string]any{"name": t.Name, "arguments": t.Arguments}})
			}
			item["tool_calls"] = calls
		}
		if m.ToolCallID != "" {
			item["tool_call_id"] = m.ToolCallID
		}
		messages = append(messages, item)
	}
	payload := map[string]any{"model": c.Model, "stream": true, "messages": messages, "max_completion_tokens": 8192}
	if len(r.Tools) > 0 {
		tools := []any{}
		for _, t := range r.Tools {
			tools = append(tools, map[string]any{"type": "function", "function": map[string]any{"name": t.Name, "description": t.Description, "parameters": t.Parameters}})
		}
		payload["tools"] = tools
	}
	if r.ForceTool != "" {
		payload["tool_choice"] = map[string]any{"type": "function", "function": map[string]any{"name": r.ForceTool}}
	}
	return payload
}

func chatParser(r *Response, delta func(string) error) func(string) (bool, error) {
	finished := false
	return func(data string) (bool, error) {
		if data == "[DONE]" {
			if !finished {
				return false, errors.New("模型未提供完成状态")
			}
			return true, nil
		}
		var event struct {
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
			Choices []struct {
				Delta struct {
					Content   string `json:"content"`
					ToolCalls []struct {
						Index    int    `json:"index"`
						ID       string `json:"id"`
						Function struct {
							Name      string `json:"name"`
							Arguments string `json:"arguments"`
						} `json:"function"`
					} `json:"tool_calls"`
				} `json:"delta"`
				FinishReason string `json:"finish_reason"`
			} `json:"choices"`
			Usage struct {
				PromptTokens     int `json:"prompt_tokens"`
				CompletionTokens int `json:"completion_tokens"`
			} `json:"usage"`
		}
		if err := json.Unmarshal([]byte(data), &event); err != nil {
			return false, err
		}
		if event.Error != nil {
			return false, errors.New(event.Error.Message)
		}
		r.Usage.InputTokens = max(r.Usage.InputTokens, event.Usage.PromptTokens)
		r.Usage.OutputTokens = max(r.Usage.OutputTokens, event.Usage.CompletionTokens)
		if len(event.Choices) > 1 {
			return false, errors.New("模型返回多个候选回复")
		}
		for _, choice := range event.Choices {
			if finished && (choice.Delta.Content != "" || len(choice.Delta.ToolCalls) > 0) {
				return false, errors.New("模型完成后仍返回内容")
			}
			if err := appendText(r, choice.Delta.Content, delta); err != nil {
				return false, err
			}
			for _, part := range choice.Delta.ToolCalls {
				if part.Index < 0 || part.Index >= MaxToolCalls {
					return false, errors.New("模型工具调用数量超过限制")
				}
				for len(r.Message.ToolCalls) <= part.Index {
					r.Message.ToolCalls = append(r.Message.ToolCalls, ToolCall{})
				}
				call := &r.Message.ToolCalls[part.Index]
				call.ID += part.ID
				call.Name += part.Function.Name
				call.Arguments += part.Function.Arguments
				if len(call.Arguments) > MaxArgumentsBytes || len(call.ID) > 256 || len(call.Name) > 128 {
					return false, errors.New("模型工具参数超过限制")
				}
			}
			if choice.FinishReason != "" {
				if choice.FinishReason != "stop" && choice.FinishReason != "tool_calls" {
					return false, errors.New("模型回复未完成: " + choice.FinishReason)
				}
				finished = true
			}
		}
		return false, nil
	}
}
