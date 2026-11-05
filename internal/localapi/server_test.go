package localapi

import (
	"context"
	"encoding/json"
	"net"
	"testing"
	"time"
)

func TestProtocolMismatchDoesNotDispatch(t *testing.T) {
	server, client := net.Pipe()
	defer client.Close()
	go serve(context.Background(), server, func(context.Context, Request) Response { t.Error("不兼容请求进入业务层"); return Result(nil) })
	client.SetDeadline(time.Now().Add(3 * time.Second))
	json.NewEncoder(client).Encode(Request{Protocol: Protocol + 1, Operation: "exec"})
	var response Response
	if err := json.NewDecoder(client).Decode(&response); err != nil || response.Error == nil || response.Error.Code != "incompatible" {
		t.Fatalf("%+v %v", response, err)
	}
}

func TestDisconnectCancelsHandler(t *testing.T) {
	server, client := net.Pipe()
	started := make(chan struct{})
	done := make(chan struct{})
	go serve(context.Background(), server, func(ctx context.Context, _ Request) Response {
		close(started)
		<-ctx.Done()
		close(done)
		return Result(nil)
	})
	json.NewEncoder(client).Encode(Request{Protocol: Protocol, Operation: "exec"})
	<-started
	client.Close()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("断开没有取消请求")
	}
}
