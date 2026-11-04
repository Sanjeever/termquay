package ssh

import (
	"context"
	"errors"
	"net"
	"strconv"
	"time"
)

func MeasureTCP(ctx context.Context, request Request) (time.Duration, error) {
	address := net.JoinHostPort(request.Host, strconv.Itoa(request.Port))
	started := time.Now()
	conn, err := connectDirect(ctx, request, address)
	elapsed := time.Since(started)
	if err != nil {
		return 0, err
	}
	conn.Close()
	return elapsed, ctx.Err()
}

func (t *Terminal) MeasureTargetTCP(ctx context.Context, address string) (time.Duration, error) {
	return t.MeasureHopTCP(ctx, len(t.jumps), address)
}

func (t *Terminal) MeasureHopTCP(ctx context.Context, hop int, address string) (time.Duration, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	client := t.client
	if hop < 0 || hop > len(t.jumps) {
		return 0, errors.New("跳板通道不存在")
	}
	if hop < len(t.jumps) {
		client = t.jumps[hop]
	}
	select {
	case t.probeSlots <- struct{}{}:
	case <-ctx.Done():
		return 0, ctx.Err()
	}
	type sample struct {
		elapsed time.Duration
		err     error
	}
	completed := make(chan sample)
	started := time.Now()
	go func() {
		defer func() { <-t.probeSlots }()
		conn, err := client.Dial("tcp", address)
		elapsed := time.Since(started)
		if conn != nil {
			conn.Close()
		}
		select {
		case completed <- sample{elapsed, err}:
		case <-ctx.Done():
		}
	}()
	select {
	case sample := <-completed:
		if err := ctx.Err(); err != nil {
			return 0, err
		}
		return sample.elapsed, sample.err
	case <-ctx.Done():
		return 0, ctx.Err()
	}
}
