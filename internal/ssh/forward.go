package ssh

import (
	"context"
	"errors"
	"fmt"
	socks "github.com/armon/go-socks5"
	"io"
	"log"
	"net"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

type ForwardSpec struct {
	Kind        string `json:"kind"`
	BindHost    string `json:"bind_host"`
	BindPort    int    `json:"bind_port"`
	TargetHost  string `json:"target_host"`
	TargetPort  int    `json:"target_port"`
	AllowPublic bool   `json:"allow_public"`
}

func (s ForwardSpec) Validate() error {
	if s.Kind != "local" && s.Kind != "remote" && s.Kind != "dynamic" {
		return errors.New("转发类型无效")
	}
	ip := net.ParseIP(s.BindHost)
	if ip == nil || s.BindPort < 0 || s.BindPort > 65535 {
		return errors.New("监听 IP 或端口无效")
	}
	if !ip.IsLoopback() && !s.AllowPublic {
		return errors.New("非回环监听需明确允许向网络暴露")
	}
	if s.Kind != "dynamic" && (s.TargetHost == "" || len(s.TargetHost) > 1024 || s.TargetPort < 1 || s.TargetPort > 65535) {
		return errors.New("转发目标无效")
	}
	return nil
}

type ForwardInfo struct {
	Address string `json:"address"`
	State   string `json:"state"`
	Active  int    `json:"active"`
	Error   string `json:"error"`
}
type activityConn struct {
	net.Conn
	last atomic.Int64
}

func (c *activityConn) Read(p []byte) (int, error) {
	n, err := c.Conn.Read(p)
	if n > 0 {
		c.last.Store(time.Now().UnixNano())
	}
	return n, err
}
func (c *activityConn) Write(p []byte) (int, error) {
	n, err := c.Conn.Write(p)
	if n > 0 {
		c.last.Store(time.Now().UnixNano())
	}
	return n, err
}
func (c *activityConn) CloseWrite() error {
	if half, ok := c.Conn.(interface{ CloseWrite() error }); ok {
		return half.CloseWrite()
	}
	return nil
}

type Forward struct {
	ctx           context.Context
	cancel        context.CancelFunc
	listener      net.Listener
	spec          ForwardSpec
	owner         *Terminal
	mu            sync.Mutex
	sources       map[*activityConn]bool
	lastError     string
	wg            sync.WaitGroup
	stopOnce      sync.Once
	stopDone      chan struct{}
	done          chan struct{}
	closeOnce     sync.Once
	remoteRelease func()
}
type remoteResolver struct{}

func (remoteResolver) Resolve(ctx context.Context, _ string) (context.Context, net.IP, error) {
	return ctx, nil, nil
}
func (t *Terminal) OpenForward(start, life context.Context, spec ForwardSpec) (*Forward, error) {
	if err := spec.Validate(); err != nil {
		return nil, err
	}
	address := net.JoinHostPort(spec.BindHost, strconv.Itoa(spec.BindPort))
	var listener net.Listener
	var err error
	var release func()
	if spec.Kind == "remote" {
		select {
		case t.forwardRequests <- struct{}{}:
		case <-start.Done():
			return nil, start.Err()
		default:
			return nil, errors.New("远端转发请求达到上限（4 个）")
		}
		release = func() { <-t.forwardRequests }
		type result struct {
			listener net.Listener
			err      error
		}
		ready := make(chan result)
		go func() {
			l, e := t.client.Listen("tcp", address)
			select {
			case ready <- result{l, e}:
			case <-start.Done():
				if l != nil {
					l.Close()
				}
				release()
			}
		}()
		select {
		case value := <-ready:
			listener, err = value.listener, value.err
			if err != nil {
				release()
				return nil, err
			}
		case <-start.Done():
			return nil, start.Err()
		}
	} else {
		listener, err = (&net.ListenConfig{}).Listen(start, "tcp", address)
		if err != nil {
			return nil, err
		}
	}
	ctx, cancel := context.WithCancel(life)
	f := &Forward{ctx: ctx, cancel: cancel, listener: listener, spec: spec, owner: t, sources: map[*activityConn]bool{}, stopDone: make(chan struct{}), done: make(chan struct{}), remoteRelease: release}
	f.wg.Add(2)
	go f.accept()
	go f.watch()
	go func() { f.wg.Wait(); close(f.done) }()
	if start.Err() != nil {
		f.Close()
		return nil, start.Err()
	}
	return f, nil
}
func (f *Forward) setError(err error) {
	if err == nil {
		return
	}
	f.mu.Lock()
	f.lastError = err.Error()
	f.mu.Unlock()
}
func (f *Forward) stopListening() {
	f.stopOnce.Do(func() {
		go func() {
			err := f.listener.Close()
			if f.remoteRelease != nil {
				f.remoteRelease()
			}
			if err != nil && f.owner.client.Conn != nil {
				f.setError(fmt.Errorf("关闭监听: %w", err))
			}
			close(f.stopDone)
		}()
	})
}
func (f *Forward) stopSources() {
	f.mu.Lock()
	sources := make([]*activityConn, 0, len(f.sources))
	for c := range f.sources {
		sources = append(sources, c)
	}
	f.mu.Unlock()
	for _, c := range sources {
		c.Close()
	}
}
func (f *Forward) Close() {
	f.closeOnce.Do(func() { f.cancel(); f.stopListening(); go f.stopSources() })
}
func (f *Forward) Wait(ctx context.Context) error {
	select {
	case <-f.done:
	case <-ctx.Done():
		return ctx.Err()
	}
	select {
	case <-f.stopDone:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
func (f *Forward) Info() ForwardInfo {
	f.mu.Lock()
	defer f.mu.Unlock()
	state := "running"
	if f.ctx.Err() != nil {
		state = "closing"
		select {
		case <-f.stopDone:
			select {
			case <-f.done:
				state = "closed"
			default:
			}
		default:
		}
	}
	return ForwardInfo{Address: f.listener.Addr().String(), State: state, Active: len(f.sources), Error: f.lastError}
}
func (f *Forward) watch() {
	defer f.wg.Done()
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-f.ctx.Done():
			f.stopListening()
			f.stopSources()
			return
		case <-ticker.C:
			f.mu.Lock()
			expired := []*activityConn{}
			for c := range f.sources {
				if time.Since(time.Unix(0, c.last.Load())) > 5*time.Minute {
					expired = append(expired, c)
					f.lastError = "转发连接空闲超时"
				}
			}
			f.mu.Unlock()
			for _, c := range expired {
				c.Close()
			}
		}
	}
}
func (f *Forward) accept() {
	defer f.wg.Done()
	defer f.cancel()
	for {
		conn, err := f.listener.Accept()
		if err != nil {
			if f.ctx.Err() == nil {
				f.setError(err)
			}
			return
		}
		select {
		case f.owner.forwardSlots <- struct{}{}:
		case <-f.ctx.Done():
			conn.Close()
			return
		default:
			conn.Close()
			f.setError(errors.New("工作区转发连接达到上限（8 个）"))
			continue
		}
		source := &activityConn{Conn: conn}
		source.last.Store(time.Now().UnixNano())
		f.mu.Lock()
		f.sources[source] = true
		f.mu.Unlock()
		f.wg.Add(1)
		go f.serve(source)
	}
}
func (f *Forward) serve(source *activityConn) {
	defer f.wg.Done()
	defer func() { source.Close(); f.mu.Lock(); delete(f.sources, source); f.mu.Unlock(); <-f.owner.forwardSlots }()
	ctx, cancel := context.WithCancel(f.ctx)
	defer cancel()
	stop := context.AfterFunc(ctx, func() { source.Close() })
	defer stop()
	dial := func(address string) (net.Conn, error) {
		dialCtx, done := context.WithTimeout(ctx, 10*time.Second)
		defer done()
		if f.spec.Kind == "remote" {
			return (&net.Dialer{Timeout: 10 * time.Second}).DialContext(dialCtx, "tcp", address)
		}
		return f.owner.client.DialContext(dialCtx, "tcp", address)
	}
	if f.spec.Kind == "dynamic" {
		source.SetDeadline(time.Now().Add(10 * time.Second))
		var target net.Conn
		server, err := socks.New(&socks.Config{Resolver: remoteResolver{}, Logger: log.New(io.Discard, "", 0), Dial: func(_ context.Context, _, address string) (net.Conn, error) {
			conn, err := dial(address)
			if err == nil {
				target = conn
				source.SetDeadline(time.Time{})
				context.AfterFunc(ctx, func() { conn.Close() })
			}
			return conn, err
		}})
		if err == nil {
			err = server.ServeConn(source)
		}
		if target != nil {
			target.Close()
		}
		if err != nil && ctx.Err() == nil {
			f.setError(err)
		}
		return
	}
	target, err := dial(net.JoinHostPort(f.spec.TargetHost, strconv.Itoa(f.spec.TargetPort)))
	if err != nil {
		f.setError(err)
		return
	}
	defer target.Close()
	stopTarget := context.AfterFunc(ctx, func() { target.Close() })
	defer stopTarget()
	done := make(chan error, 1)
	copyOne := func(dst io.Writer, src io.Reader) error {
		_, err := io.CopyBuffer(dst, src, make([]byte, 32<<10))
		if half, ok := dst.(interface{ CloseWrite() error }); ok {
			half.CloseWrite()
		}
		return err
	}
	go func() { done <- copyOne(target, source) }()
	err = copyOne(source, target)
	if other := <-done; err == nil {
		err = other
	}
	if err != nil && ctx.Err() == nil {
		f.setError(err)
	}
}
