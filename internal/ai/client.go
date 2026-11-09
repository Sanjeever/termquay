package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"

	"io"
	"net"
	"net/http"
	"net/http/httptrace"
	"strings"
	"sync/atomic"
	"time"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	"github.com/tmaxmax/go-sse"
)

type Client struct {
	config         Config
	http           *http.Client
	requestTimeout time.Duration
}

func NewClient(config Config) *Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxIdleConns = 2
	transport.MaxIdleConnsPerHost = 2
	transport.MaxConnsPerHost = 2
	transport.ResponseHeaderTimeout = 120 * time.Second
	return &Client{config: config, requestTimeout: config.RequestTimeout(), http: &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error {
		return appmessage.New("backend:aIRequestsCannotRedirectEnterTheFinalRequest", "AI 请求不允许重定向，请填写最终请求 URL")
	}}}
}

func (c *Client) Close() { c.http.CloseIdleConnections() }

func (c *Client) Stream(parent context.Context, input Request, delta func(string) error) (response Response, resultErr error) {
	ctx, cancel := context.WithTimeout(parent, c.requestTimeout)
	defer cancel()
	defer func() {
		if resultErr == nil {
			return
		}
		switch {
		case parent.Err() != nil:
			resultErr = context.Cause(parent)
		case ctx.Err() == context.DeadlineExceeded:
			resultErr = appmessage.Errorf("backend:modelWaitTimeExceededMinutes", "等待模型超过设定时间（%d 分钟）: %w", int(c.config.RequestTimeout().Minutes()), context.DeadlineExceeded)
		default:
			resultErr = c.cleanError(resultErr)
		}
	}()
	if err := c.config.Validate(); err != nil {
		return Response{}, err
	}
	for _, message := range input.Messages {
		if message.Protocol != c.config.Protocol || message.Native == "" {
			continue
		}
		var blocks []json.RawMessage
		if err := json.Unmarshal([]byte(message.Native), &blocks); err != nil || blocks == nil {
			return Response{}, appmessage.New("backend:aIProtocolContinuationDataIsCorrupted", "AI 协议续接内容损坏")
		}
	}
	var payload any
	var parse func(string) (bool, error)
	r := Response{Message: Message{Role: "assistant", Protocol: c.config.Protocol}}
	switch c.config.Protocol {
	case "chat_completions":
		payload = chatRequest(c.config, input)
		parse = chatParser(&r, delta)
	case "messages":
		payload = messagesRequest(c.config, input)
		parse = messagesParser(&r, delta)
	case "responses":
		payload = responsesRequest(c.config, input)
		parse = responsesParser(&r, delta)
	default:
		return r, appmessage.New("backend:aIProtocolAdapterIsNotAvailableYet", "AI 协议适配尚不可用")
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return r, err
	}
	if len(b) > 2*MaxContextBytes {
		return r, appmessage.New("backend:modelRequestExceedsTheContextBudget", "模型请求超过上下文预算")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.config.Endpoint, bytes.NewReader(b))
	if err != nil {
		return r, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	if c.config.Protocol == "messages" {
		req.Header.Set("x-api-key", c.config.APIKey)
		req.Header.Set("anthropic-version", "2023-06-01")
	} else if c.config.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.config.APIKey)
	}
	var wroteRequest atomic.Bool
	req = req.WithContext(httptrace.WithClientTrace(req.Context(), &httptrace.ClientTrace{WroteRequest: func(info httptrace.WroteRequestInfo) {
		if info.Err == nil {
			wroteRequest.Store(true)
		}
	}}))
	res, err := c.http.Do(req)
	if err != nil {
		var networkError net.Error
		if errors.As(err, &networkError) && networkError.Timeout() {
			if wroteRequest.Load() {
				return r, appmessage.Errorf("backend:timedOutWaitingForModelResponseHeaders", "等待模型响应头超时: %w", err)
			}
			return r, appmessage.Errorf("backend:timedOutConnectingToModelService", "连接模型服务超时: %w", err)
		}
		return r, appmessage.Errorf("backend:couldNotConnectToModelService", "连接模型服务失败: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		body, readErr := io.ReadAll(io.LimitReader(res.Body, 8192))
		if readErr != nil {
			return r, appmessage.Errorf("backend:couldNotReadModelErrorResponse", "读取模型错误响应失败: %w", readErr)
		}
		var detail struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.Unmarshal(body, &detail)
		return r, c.cleanError(appmessage.Errorf("backend:modelHTTP", "模型 HTTP %d: %s", res.StatusCode, detail.Error.Message))
	}
	if !strings.HasPrefix(res.Header.Get("Content-Type"), "text/event-stream") {
		return r, appmessage.New("backend:theModelDidNotReturnAnSSEText", "模型未返回 SSE 文本流")
	}
	reader := &io.LimitedReader{R: modelActivityReader{Reader: res.Body, activity: input.OnActivity}, N: MaxWireBytes + 1}
	complete := false
	for event, err := range sse.Read(reader, &sse.ReadConfig{MaxEventSize: 512 << 10}) {
		if err != nil {
			return r, appmessage.Errorf("backend:modelResponseStreamInterrupted", "模型响应流中断: %w", err)
		}
		if ctx.Err() != nil {
			return r, ctx.Err()
		}
		complete, err = parse(event.Data)
		if err != nil {
			return r, c.cleanError(err)
		}
		if complete {
			break
		}
	}
	if reader.N <= 0 {
		return r, appmessage.New("backend:modelNetworkResponseExceedsTheLimit", "模型网络响应超过限制")
	}
	if !complete {
		return r, appmessage.New("backend:modelStreamEndedBeforeTheCompleteEndMarker", "模型流提前结束，未收到完整结束标记")
	}
	if len(r.Message.Content) > MaxResponseBytes || len(r.Message.Native) > 256<<10 {
		return r, appmessage.New("backend:modelResponseExceedsTheLimit", "模型响应超过限制")
	}
	seen := map[string]bool{}
	for _, call := range r.Message.ToolCalls {
		var args map[string]json.RawMessage
		if call.ID == "" || len(call.ID) > 256 || call.Name == "" || seen[call.ID] || len(call.Arguments) > MaxArgumentsBytes || json.Unmarshal([]byte(call.Arguments), &args) != nil || args == nil {
			return r, appmessage.New("backend:invalidModelToolCallIdentifierOrArguments", "模型工具调用标识或参数无效")
		}
		seen[call.ID] = true
	}
	return r, nil
}

func (c *Client) cleanError(err error) error {
	message := err.Error()
	if c.config.APIKey != "" {
		message = strings.ReplaceAll(message, c.config.APIKey, "[API Key]")
	}
	if len(message) > 2048 {
		message = message[:2048] + "…"
	}
	return errors.New(message)
}

type modelActivityReader struct {
	io.Reader
	activity func()
}

func (r modelActivityReader) Read(data []byte) (int, error) {
	n, err := r.Reader.Read(data)
	if n > 0 && r.activity != nil {
		r.activity()
	}
	return n, err
}

func appendText(r *Response, text string, delta func(string) error) error {
	if len(r.Message.Content)+len(text) > MaxResponseBytes {
		return appmessage.New("backend:modelResponseExceededTheLimitAndWasStopped", "模型回复超过限制，已停止")
	}
	r.Message.Content += text
	if text != "" && delta != nil {
		return delta(text)
	}
	return nil
}
