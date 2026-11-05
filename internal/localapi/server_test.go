package localapi

import (
	"context"
	"encoding/json"
	"net"
	"os"
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

func TestNativeTransportAndEndpointConflict(t *testing.T) {
	dir, err := os.MkdirTemp("", "tq-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	t.Setenv("TMPDIR", dir)
	server, err := Listen(func(_ context.Context, r Request) Response { return Result(r.Operation) })
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	other, err := Listen(func(context.Context, Request) Response { return Result(nil) })
	if err == nil {
		other.Close()
		t.Fatal("活跃实例端点被重复占用")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	response := Call(ctx, Request{Operation: "status"})
	if response.Error != nil || string(response.Data) != `"status"` {
		t.Fatalf("原生 IPC 往返失败：%+v", response)
	}
}
