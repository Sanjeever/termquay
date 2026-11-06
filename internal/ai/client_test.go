package ai

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestAllProtocolsCancelNetworkAndRejectOversizedEvents(t *testing.T) {
	for _, protocol := range []string{"chat_completions", "messages", "responses"} {
		t.Run(protocol, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				w.(http.Flusher).Flush()
				<-r.Context().Done()
			}))
			c := NewClient(Config{Enabled: true, Protocol: protocol, Endpoint: s.URL, Model: "test"})
			ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
			if _, err := c.Stream(ctx, Request{}, nil); err == nil {
				t.Error("网络读取没有取消")
			}
			cancel()
			s.Close()
			s = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				fmt.Fprintf(w, "data: %s\n\n", strings.Repeat("x", 513<<10))
			}))
			defer s.Close()
			c = NewClient(Config{Enabled: true, Protocol: protocol, Endpoint: s.URL, Model: "test"})
			if _, err := c.Stream(context.Background(), Request{}, nil); err == nil {
				t.Error("事件读取没有大小限制")
			}
		})
	}
}

func TestModelRequestsDoNotRedirectRetryOrLeakKey(t *testing.T) {
	var requests atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		http.Redirect(w, r, "/redirected", http.StatusTemporaryRedirect)
	}))
	defer s.Close()
	c := NewClient(Config{Enabled: true, Protocol: "chat_completions", Endpoint: s.URL, Model: "test"})
	if _, err := c.Stream(context.Background(), Request{}, nil); err == nil || requests.Load() != 1 {
		t.Fatal("模型请求重试或重定向")
	}
	s2 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		fmt.Fprint(w, `{"error":{"message":"synthetic-key rejected"}}`)
	}))
	defer s2.Close()
	c = NewClient(Config{Enabled: true, Protocol: "messages", Endpoint: s2.URL, Model: "test", APIKey: "synthetic-key"})
	if _, err := c.Stream(context.Background(), Request{}, nil); err == nil || strings.Contains(err.Error(), "synthetic-key") || !strings.Contains(err.Error(), "401") {
		t.Fatalf("HTTP 错误丢失或 Key 泄露: %v", err)
	}
}

func TestCorruptNativeContinuationIsNotSilentlyDropped(t *testing.T) {
	for _, protocol := range []string{"messages", "responses"} {
		c := NewClient(Config{Enabled: true, Protocol: protocol, Endpoint: "http://example.invalid", Model: "test"})
		for _, native := range []string{`{"broken":true}`, `null`, `[`} {
			if _, err := c.Stream(context.Background(), Request{Messages: []Message{{Role: "assistant", Protocol: protocol, Native: native}}}, nil); err == nil || !strings.Contains(err.Error(), "续接内容损坏") {
				t.Fatalf("损坏续接未明确失败: %v", err)
			}
		}
	}
}

func TestMessagesPreservesEmptySignedThinking(t *testing.T) {
	r := Response{Message: Message{Role: "assistant"}}
	parse := messagesParser(&r, nil)
	for _, event := range []string{`{"type":"message_start"}`, `{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}`, `{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"synthetic-signature"}}`, `{"type":"content_block_stop","index":0}`, `{"type":"message_delta","delta":{"stop_reason":"end_turn"}}`, `{"type":"message_stop"}`} {
		if _, err := parse(event); err != nil {
			t.Fatal(err)
		}
	}
	if !strings.Contains(r.Message.Native, `"thinking":""`) || !strings.Contains(r.Message.Native, `"signature":"synthetic-signature"`) {
		t.Fatal("空 thinking 字段或签名丢失")
	}
}

func TestClientCloseReleasesOnlyOwnedConnections(t *testing.T) {
	var aiClosed, otherClosed atomic.Int32
	server := func(closed *atomic.Int32) *httptest.Server {
		s := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "body") }))
		s.Config.ConnState = func(_ net.Conn, state http.ConnState) {
			if state == http.StateClosed {
				closed.Add(1)
			}
		}
		s.Start()
		t.Cleanup(s.Close)
		return s
	}
	other, model := server(&otherClosed), server(&aiClosed)
	read := func(client *http.Client, url string) {
		r, err := client.Get(url)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.Copy(io.Discard, r.Body); err != nil {
			t.Fatal(err)
		}
		r.Body.Close()
	}
	read(http.DefaultClient, other.URL)
	c := NewClient(Config{})
	defer c.Close()
	read(c.http, model.URL)
	c.Close()
	deadline := time.Now().Add(time.Second)
	for aiClosed.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if aiClosed.Load() != 1 || otherClosed.Load() != 0 {
		t.Fatal("AI 连接未释放或误关共享 HTTP 连接")
	}
}

func TestModelRequestTimeout(t *testing.T) {
	config := Config{Enabled: true, Protocol: "chat_completions", Endpoint: "https://example.invalid/chat", Model: "test"}
	c := NewClient(config)
	defer c.Close()
	if c.http.Timeout != 0 || c.requestTimeout != 10*time.Minute || c.http.Transport.(*http.Transport).ResponseHeaderTimeout != 120*time.Second {
		t.Fatal("模型仍受固定短时限限制")
	}
	config.RequestTimeoutMinutes = 30
	if err := config.Validate(); err != nil || config.RequestTimeout() != 30*time.Minute {
		t.Fatal("无法设置最长等待时间")
	}
	for _, minutes := range []int{-1, 31} {
		config.RequestTimeoutMinutes = minutes
		if config.Validate() == nil {
			t.Fatal("接受无效等待时间")
		}
	}
	for _, protocol := range []string{"chat_completions", "messages", "responses"} {
		t.Run(protocol, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				w.(http.Flusher).Flush()
				<-r.Context().Done()
			}))
			defer s.Close()
			client := NewClient(Config{Enabled: true, Protocol: protocol, Endpoint: s.URL, Model: "test"})
			defer client.Close()
			client.requestTimeout = 30 * time.Millisecond
			_, err := client.Stream(context.Background(), Request{}, nil)
			if err == nil || !errors.Is(err, context.DeadlineExceeded) || !strings.Contains(err.Error(), "等待模型超过设定时间") {
				t.Fatalf("模型等待超时未单独报告: %v", err)
			}
			ctx, cancel := context.WithCancelCause(context.Background())
			cause := errors.New("synthetic run stopped")
			cancel(cause)
			if _, err := client.Stream(ctx, Request{}, nil); !errors.Is(err, cause) {
				t.Fatalf("调用者取消被误报模型超时: %v", err)
			}
		})
	}
	t.Run("response_headers", func(t *testing.T) {
		release := make(chan struct{})
		s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-release }))
		defer s.Close()
		defer close(release)
		client := NewClient(Config{Enabled: true, Protocol: "chat_completions", Endpoint: s.URL, Model: "test"})
		defer client.Close()
		client.http.Transport.(*http.Transport).ResponseHeaderTimeout = 30 * time.Millisecond
		if _, err := client.Stream(context.Background(), Request{}, nil); err == nil || !strings.Contains(err.Error(), "等待模型响应头超时") {
			t.Fatalf("响应头超时未区分: %v", err)
		}
	})
}
