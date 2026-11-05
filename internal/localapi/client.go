package localapi

import (
	"context"
	"encoding/json"
	"io"
	"time"
)

func Call(ctx context.Context, request Request) Response {
	conn, err := dial(ctx)
	if err != nil {
		return Failure("unavailable", "桌面实例不可用："+err.Error(), false)
	}
	defer conn.Close()
	stop := context.AfterFunc(ctx, func() { conn.Close() })
	defer stop()
	request.Protocol = Protocol
	conn.SetDeadline(time.Now().Add(615 * time.Second))
	if err := json.NewEncoder(conn).Encode(request); err != nil {
		return Failure("transport", err.Error(), request.Operation == "exec")
	}
	var response Response
	if err := json.NewDecoder(io.LimitReader(conn, MaxResponse)).Decode(&response); err != nil {
		return Failure("transport", err.Error(), request.Operation == "exec")
	}
	if response.Protocol != Protocol {
		return Failure("incompatible", "CLI 与桌面 IPC 协议不兼容，请使用同一发行包", false)
	}
	return response
}
