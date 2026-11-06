package app

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/Sanjeever/termquay/internal/ai"
)

type AITestResult struct {
	OK    bool   `json:"ok"`
	Error string `json:"error"`
}

type AIConnectionTest struct {
	Reply AITestResult `json:"reply"`
	Tools AITestResult `json:"tools"`
}

func (a *AppService) TestAIConnection(ctx context.Context, update AISettingsUpdate) (AIConnectionTest, error) {
	a.aiMu.Lock()
	if a.aiStopped || a.appLocked.Load() || len(a.aiTests) > 0 {
		a.aiMu.Unlock()
		return AIConnectionTest{}, errors.New("应用已锁定、退出或正在测试 AI 连接")
	}
	config, err := a.aiConfig()
	if err == nil {
		config, err = updatedAIConfig(config, update)
	}
	if err != nil {
		a.aiMu.Unlock()
		return AIConnectionTest{}, err
	}
	config.Enabled = true
	if err := config.Validate(); err != nil {
		a.aiMu.Unlock()
		return AIConnectionTest{}, err
	}
	testCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	id := aiID()
	if a.aiTests == nil {
		a.aiTests = map[string]context.CancelFunc{}
	}
	a.aiTests[id] = cancel
	a.aiWorkers.Add(1)
	a.aiMu.Unlock()
	defer a.aiWorkers.Done()
	defer func() { cancel(); a.aiMu.Lock(); delete(a.aiTests, id); a.aiMu.Unlock() }()
	client := ai.NewClient(config)
	result := AIConnectionTest{}
	response, err := client.Stream(testCtx, ai.Request{System: "连接测试，请简短回复。", Messages: []ai.Message{{Role: "user", Content: "请回复连接正常。"}}}, nil)
	if err == nil && (response.Message.Content == "" || len(response.Message.ToolCalls) > 0) {
		err = errors.New("模型未返回普通文本回复")
	}
	result.Reply.OK = err == nil
	if err != nil {
		result.Reply.Error = err.Error()
	}
	request := ai.Request{System: "本机无副作用的工具协议测试，只调用 connection_probe，参数 value 为 termquay。", Messages: []ai.Message{{Role: "user", Content: "请调用测试工具，收到结果后回复测试完成。"}}, Tools: []ai.Tool{{Name: "connection_probe", Description: "本机无副作用的连接测试", Parameters: json.RawMessage(`{"type":"object","properties":{"value":{"type":"string"}},"required":["value"],"additionalProperties":false}`)}}, ForceTool: "connection_probe"}
	response, err = client.Stream(testCtx, request, nil)
	if err == nil {
		if len(response.Message.ToolCalls) != 1 || response.Message.ToolCalls[0].Name != "connection_probe" {
			err = errors.New("模型没有调用测试工具")
		} else {
			call := response.Message.ToolCalls[0]
			var args map[string]string
			if json.Unmarshal([]byte(call.Arguments), &args) != nil || len(args) != 1 || args["value"] != "termquay" {
				err = errors.New("测试工具参数无效")
			} else {
				request.Messages = append(request.Messages, response.Message, ai.Message{Role: "tool", ToolCallID: call.ID, Content: `{"ok":true,"value":"termquay"}`})
				request.ForceTool = ""
				request.Tools = nil
				response, err = client.Stream(testCtx, request, nil)
				if err == nil && (response.Message.Content == "" || len(response.Message.ToolCalls) > 0) {
					err = errors.New("模型未完成工具结果续接")
				}
			}
		}
	}
	result.Tools.OK = err == nil
	if err != nil {
		result.Tools.Error = err.Error()
	}
	return result, nil
}
