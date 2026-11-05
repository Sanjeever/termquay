package localapi

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"sync"
	"time"
)

type Server struct {
	listener net.Listener
	cancel   context.CancelFunc
	once     sync.Once
}

func Listen(handler func(context.Context, Request) Response) (*Server, error) {
	l, err := listen()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	s := &Server{listener: l, cancel: cancel}
	go func() {
		slots := make(chan struct{}, 8)
		for {
			conn, err := l.Accept()
			if err != nil {
				return
			}
			select {
			case slots <- struct{}{}:
				go func() { defer func() { <-slots }(); serve(ctx, conn, handler) }()
			default:
				conn.Close()
			}
		}
	}()
	return s, nil
}

func (s *Server) Close() { s.once.Do(func() { s.cancel(); s.listener.Close() }) }

func serve(parent context.Context, conn net.Conn, handler func(context.Context, Request) Response) {
	defer conn.Close()
	ctx, cancel := context.WithTimeout(parent, 610*time.Second)
	defer cancel()
	stop := context.AfterFunc(ctx, func() { conn.Close() })
	defer stop()
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	decoder := json.NewDecoder(io.LimitReader(conn, MaxRequest))
	decoder.DisallowUnknownFields()
	var request Request
	if err := decoder.Decode(&request); err != nil {
		writeResponse(conn, Failure("invalid_request", "请求格式无效或超过限制", false))
		return
	}
	conn.SetReadDeadline(time.Time{})
	go func() { var extra any; decoder.Decode(&extra); cancel() }()
	if request.Protocol != Protocol {
		writeResponse(conn, Failure("incompatible", "CLI 与桌面 IPC 协议不兼容", false))
		return
	}
	writeResponse(conn, handler(ctx, request))
}

func writeResponse(conn net.Conn, response Response) {
	conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	json.NewEncoder(conn).Encode(response)
}
