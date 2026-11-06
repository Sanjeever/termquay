package ai

import (
	"encoding/json"
	"errors"
)

func responsesRequest(c Config, r Request) any {
	input := []any{}
	for _, m := range r.Messages {
		if m.Role == "tool" {
			input = append(input, map[string]any{"type": "function_call_output", "call_id": m.ToolCallID, "output": m.Content})
		} else if m.Protocol == "responses" && m.Native != "" {
			var items []json.RawMessage
			if json.Unmarshal([]byte(m.Native), &items) == nil {
				for _, item := range items {
					input = append(input, item)
				}
			}
		} else {
			if m.ModelContent() != "" {
				input = append(input, map[string]any{"role": m.Role, "content": m.ModelContent()})
			}
			for _, call := range m.ToolCalls {
				input = append(input, map[string]any{"type": "function_call", "call_id": call.ID, "name": call.Name, "arguments": call.Arguments})
			}
		}
	}
	payload := map[string]any{"model": c.Model, "stream": true, "instructions": r.System, "input": input, "store": false, "include": []string{"reasoning.encrypted_content"}, "max_output_tokens": 8192, "truncation": "disabled"}
	if len(r.Tools) > 0 {
		tools := []any{}
		for _, t := range r.Tools {
			tools = append(tools, map[string]any{"type": "function", "name": t.Name, "description": t.Description, "parameters": t.Parameters, "strict": false})
		}
		payload["tools"] = tools
	}
	if r.ForceTool != "" {
		payload["tool_choice"] = map[string]any{"type": "function", "name": r.ForceTool}
	}
	return payload
}

func responsesParser(r *Response, delta func(string) error) func(string) (bool, error) {
	arguments := map[int]string{}
	return func(data string) (bool, error) {
		var e struct {
			Type        string `json:"type"`
			Delta       string `json:"delta"`
			OutputIndex int    `json:"output_index"`
			Message     string `json:"message"`
			Response    struct {
				Status string            `json:"status"`
				Output []json.RawMessage `json:"output"`
				Usage  Usage             `json:"usage"`
				Error  *struct {
					Message string `json:"message"`
				} `json:"error"`
			} `json:"response"`
		}
		if err := json.Unmarshal([]byte(data), &e); err != nil {
			return false, err
		}
		switch e.Type {
		case "error":
			return false, errors.New("模型流错误: " + e.Message)
		case "response.failed", "response.incomplete":
			message := e.Type
			if e.Response.Error != nil {
				message += ": " + e.Response.Error.Message
			}
			return false, errors.New(message)
		case "response.output_text.delta":
			return false, appendText(r, e.Delta, delta)
		case "response.refusal.delta":
			return false, errors.New("模型拒绝回复: " + e.Delta)
		case "response.function_call_arguments.delta":
			if e.OutputIndex < 0 || e.OutputIndex >= 32 {
				return false, errors.New("Responses 输出序号无效")
			}
			arguments[e.OutputIndex] += e.Delta
			if len(arguments[e.OutputIndex]) > MaxArgumentsBytes {
				return false, errors.New("模型工具参数超过限制")
			}
		case "response.completed":
			if e.Response.Status != "completed" || e.Response.Output == nil {
				return false, errors.New("Responses 回复状态无效")
			}
			text := ""
			for i, raw := range e.Response.Output {
				var item struct {
					Type      string `json:"type"`
					CallID    string `json:"call_id"`
					Name      string `json:"name"`
					Arguments string `json:"arguments"`
					Content   []struct {
						Type string `json:"type"`
						Text string `json:"text"`
					} `json:"content"`
				}
				if err := json.Unmarshal(raw, &item); err != nil {
					return false, err
				}
				switch item.Type {
				case "message":
					for _, part := range item.Content {
						if part.Type != "output_text" {
							return false, errors.New("Responses 返回不支持的消息内容: " + part.Type)
						}
						text += part.Text
					}
				case "function_call":
					if args, ok := arguments[i]; ok && args != item.Arguments {
						return false, errors.New("Responses 工具参数与完成项不一致")
					}
					r.Message.ToolCalls = append(r.Message.ToolCalls, ToolCall{ID: item.CallID, Name: item.Name, Arguments: item.Arguments})
					if len(r.Message.ToolCalls) > MaxToolCalls {
						return false, errors.New("模型工具调用数量超过限制")
					}
				case "reasoning":
				default:
					return false, errors.New("Responses 返回不支持的输出类型: " + item.Type)
				}
			}
			if text != r.Message.Content {
				return false, errors.New("Responses 流式文本与完成项不一致")
			}
			b, err := json.Marshal(e.Response.Output)
			if err != nil {
				return false, err
			}
			r.Message.Native = string(b)
			r.Usage = e.Response.Usage
			return true, nil
		}
		return false, nil
	}
}
