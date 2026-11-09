package ai

import (
	"encoding/json"
	"errors"
	appmessage "github.com/Sanjeever/termquay/internal/message"
)

func messagesRequest(c Config, r Request) any {
	messages := []map[string]any{}
	for _, m := range r.Messages {
		role := m.Role
		var content any
		if role == "tool" {
			role = "user"
			content = []any{map[string]any{"type": "tool_result", "tool_use_id": m.ToolCallID, "content": m.Content, "is_error": m.IsError}}
		} else if m.Protocol == "messages" && m.Native != "" {
			content = json.RawMessage(m.Native)
		} else {
			blocks := []any{}
			if m.ModelContent() != "" {
				blocks = append(blocks, map[string]any{"type": "text", "text": m.ModelContent()})
			}
			for _, call := range m.ToolCalls {
				blocks = append(blocks, map[string]any{"type": "tool_use", "id": call.ID, "name": call.Name, "input": json.RawMessage(call.Arguments)})
			}
			content = blocks
		}
		// Messages 要求同批工具结果在同一 user 消息内。
		if m.Role == "tool" && len(messages) > 0 && messages[len(messages)-1]["role"] == "user" {
			if previous, ok := messages[len(messages)-1]["content"].([]any); ok {
				messages[len(messages)-1]["content"] = append(previous, content.([]any)...)
				continue
			}
		}
		messages = append(messages, map[string]any{"role": role, "content": content})
	}
	payload := map[string]any{"model": c.Model, "stream": true, "system": r.System, "messages": messages, "max_tokens": 32000}
	if len(r.Tools) > 0 {
		tools := []any{}
		for _, t := range r.Tools {
			tools = append(tools, map[string]any{"name": t.Name, "description": t.Description, "input_schema": t.Parameters})
		}
		payload["tools"] = tools
	}
	if r.ForceTool != "" {
		payload["tool_choice"] = map[string]any{"type": "tool", "name": r.ForceTool}
	}
	if r.TextOnly {
		payload["tool_choice"] = map[string]any{"type": "none"}
	}
	return payload
}

type messageBlock struct {
	Type      string          `json:"type"`
	ID        string          `json:"id,omitempty"`
	Name      string          `json:"name,omitempty"`
	Text      string          `json:"text,omitempty"`
	Thinking  string          `json:"thinking,omitempty"`
	Signature string          `json:"signature,omitempty"`
	Data      string          `json:"data,omitempty"`
	Input     json.RawMessage `json:"input,omitempty"`
}

func messagesParser(r *Response, delta func(string) error) func(string) (bool, error) {
	blocks := []messageBlock{}
	arguments := map[int]string{}
	closed := map[int]bool{}
	started, reason := false, ""
	size := 0
	return func(data string) (bool, error) {
		var e struct {
			Type         string       `json:"type"`
			Index        int          `json:"index"`
			ContentBlock messageBlock `json:"content_block"`
			Delta        struct {
				Type        string `json:"type"`
				Text        string `json:"text"`
				PartialJSON string `json:"partial_json"`
				Thinking    string `json:"thinking"`
				Signature   string `json:"signature"`
				StopReason  string `json:"stop_reason"`
			} `json:"delta"`
			Message struct {
				Usage Usage `json:"usage"`
			} `json:"message"`
			Usage Usage `json:"usage"`
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if err := json.Unmarshal([]byte(data), &e); err != nil {
			return false, err
		}
		switch e.Type {
		case "error":
			return false, errors.New("模型流错误: " + e.Error.Message)
		case "message_start":
			if started {
				return false, appmessage.New("backend:duplicateModelMessageStart", "重复的模型消息起点")
			}
			started = true
			r.Usage = e.Message.Usage
		case "content_block_start":
			if !started || e.Index != len(blocks) || len(blocks) >= MaxResponseBlocks {
				return false, appmessage.New("backend:invalidMessagesContentBlockIndex", "Messages 内容块序号无效")
			}
			switch e.ContentBlock.Type {
			case "text", "tool_use", "thinking", "redacted_thinking":
			default:
				return false, errors.New("Messages 返回不支持的内容块: " + e.ContentBlock.Type)
			}
			blocks = append(blocks, e.ContentBlock)
			size += len(e.ContentBlock.Text) + len(e.ContentBlock.Thinking) + len(e.ContentBlock.Signature) + len(e.ContentBlock.Data) + len(e.ContentBlock.Input)
			if e.ContentBlock.Type == "text" {
				if err := appendText(r, e.ContentBlock.Text, delta); err != nil {
					return false, err
				}
			}
		case "content_block_delta":
			if e.Index < 0 || e.Index >= len(blocks) || closed[e.Index] {
				return false, appmessage.New("backend:messagesDeltaHasNoCorrespondingContentBlock", "Messages 增量没有对应内容块")
			}
			block := &blocks[e.Index]
			switch {
			case e.Delta.Type == "text_delta" && block.Type == "text":
				block.Text += e.Delta.Text
				if err := appendText(r, e.Delta.Text, delta); err != nil {
					return false, err
				}
			case e.Delta.Type == "input_json_delta" && block.Type == "tool_use":
				arguments[e.Index] += e.Delta.PartialJSON
				if len(arguments[e.Index]) > MaxArgumentsBytes {
					return false, appmessage.New("backend:toolArgumentsExceedTheLimit", "工具参数超过限制")
				}
			case e.Delta.Type == "thinking_delta" && block.Type == "thinking":
				block.Thinking += e.Delta.Thinking
			case e.Delta.Type == "signature_delta" && block.Type == "thinking":
				block.Signature += e.Delta.Signature
			default:
				return false, appmessage.New("backend:invalidMessagesContentDeltaType", "Messages 内容增量类型无效")
			}
			size += len(e.Delta.Text) + len(e.Delta.PartialJSON) + len(e.Delta.Thinking) + len(e.Delta.Signature)
		case "content_block_stop":
			if e.Index < 0 || e.Index >= len(blocks) || closed[e.Index] {
				return false, appmessage.New("backend:invalidMessagesContentBlockEnd", "Messages 内容块结束无效")
			}
			closed[e.Index] = true
			if blocks[e.Index].Type == "tool_use" {
				if v, ok := arguments[e.Index]; ok {
					blocks[e.Index].Input = json.RawMessage(v)
				}
				b := blocks[e.Index]
				r.Message.ToolCalls = append(r.Message.ToolCalls, ToolCall{ID: b.ID, Name: b.Name, Arguments: string(b.Input)})
				if len(r.Message.ToolCalls) > MaxToolCalls {
					return false, appmessage.New("backend:modelToolCallCountExceedsTheLimit", "模型单批工具调用超过协议保护上限")
				}
			}
		case "message_delta":
			reason = e.Delta.StopReason
			r.Usage.InputTokens = max(r.Usage.InputTokens, e.Usage.InputTokens)
			r.Usage.OutputTokens = max(r.Usage.OutputTokens, e.Usage.OutputTokens)
		case "message_stop":
			if !started || len(closed) != len(blocks) || (reason != "end_turn" && reason != "tool_use" && reason != "stop_sequence") {
				return false, errors.New("Messages 回复未完成: " + reason)
			}
			content := []map[string]any{}
			for _, block := range blocks {
				item := map[string]any{"type": block.Type}
				switch block.Type {
				case "text":
					item["text"] = block.Text
				case "thinking":
					item["thinking"] = block.Thinking
					item["signature"] = block.Signature
				case "redacted_thinking":
					item["data"] = block.Data
				case "tool_use":
					item["id"] = block.ID
					item["name"] = block.Name
					item["input"] = block.Input
				}
				content = append(content, item)
			}
			b, err := json.Marshal(content)
			if err != nil {
				return false, err
			}
			r.Message.Native = string(b)
			return true, nil
		}
		if size > 256<<10 {
			return false, appmessage.New("backend:messagesContentExceedsTheLimit", "Messages 内容超过限制")
		}
		return false, nil
	}
}
