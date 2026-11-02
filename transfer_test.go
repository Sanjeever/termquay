package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"testing"
	"time"
)

func TestTransferCopyCancellationAndProgress(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var target bytes.Buffer
	var reported int64
	writer := &transferWriter{ctx: ctx, writer: &target, total: 1 << 20, report: func(done, total int64) {
		reported = done
		if total != 1<<20 {
			t.Fatal("总大小不一致")
		}
		cancel()
	}}
	_, err := io.CopyBuffer(writer, io.LimitReader(bytes.NewReader(make([]byte, 1<<20)), 1<<20), make([]byte, 32<<10))
	if !errors.Is(err, context.Canceled) {
		t.Fatal("取消没有终止复制")
	}
	if target.Len() != 32<<10 || reported != 32<<10 {
		t.Fatal("取消后继续写入或进度不一致")
	}
}

func TestTransferCopyPreservesBytes(t *testing.T) {
	data := bytes.Repeat([]byte{0, 255, 13, 10, 27}, 100000)
	var target bytes.Buffer
	var reported int64
	writer := &transferWriter{ctx: context.Background(), writer: &target, total: int64(len(data)), report: func(done, total int64) { reported = done }}
	if _, err := io.CopyBuffer(writer, io.LimitReader(bytes.NewReader(data), int64(len(data))), make([]byte, 64<<10)); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(target.Bytes(), data) || reported != int64(len(data)) {
		t.Fatal("传输改变协议字节或进度不一致")
	}
}

func TestTransferQueueFIFOAndWaitingCancellation(t *testing.T) {
	a := NewAppService()
	a.transferEvent = func(Transfer) {}
	a.workspaces["workspace"] = &workspaceOwner{}
	started := make(chan int, 5)
	gates := make([]chan struct{}, 5)
	views := make([]Transfer, 5)
	for i := range gates {
		gates[i] = make(chan struct{})
		i := i
		view, err := a.startTransfer("workspace", "test", "upload", 0, func(ctx context.Context, _ func(int64, int64)) error {
			started <- i
			select {
			case <-gates[i]:
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		})
		if err != nil {
			t.Fatal(err)
		}
		views[i] = view
	}
	t.Cleanup(func() {
		for _, view := range views {
			a.CancelTransfer(view.ID)
		}
	})
	next := func() int {
		t.Helper()
		select {
		case i := <-started:
			return i
		case <-time.After(3 * time.Second):
			t.Fatal("等待队列未推进")
			return -1
		}
	}
	first, second := next(), next()
	if first+second != 1 {
		t.Fatal("并行任务不是最先进入的两项")
	}
	a.ClearTransfer(views[3].ID)
	a.mu.Lock()
	exists := a.transfers[views[3].ID] != nil
	a.mu.Unlock()
	if !exists {
		t.Fatal("等待任务被移除")
	}
	a.CancelTransfer(views[3].ID)
	close(gates[0])
	if next() != 2 {
		t.Fatal("未按 FIFO 调度")
	}
	close(gates[1])
	if next() != 4 {
		t.Fatal("已取消等待任务仍被执行")
	}
	close(gates[2])
	close(gates[4])
	for _, view := range views {
		a.mu.Lock()
		done := a.transfers[view.ID].done
		a.mu.Unlock()
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			t.Fatal("任务未结束")
		}
	}
	if a.transfers[views[3].ID].view.State != "cancelled" {
		t.Fatal("等待取消状态错误")
	}
}

func TestTransferQueueBound(t *testing.T) {
	a := NewAppService()
	a.transferEvent = func(Transfer) {}
	a.workspaces["workspace"] = &workspaceOwner{}
	views := []Transfer{}
	t.Cleanup(func() {
		for _, v := range views {
			a.CancelTransfer(v.ID)
		}
	})
	for range 34 {
		v, err := a.startTransfer("workspace", "test", "upload", 0, func(ctx context.Context, _ func(int64, int64)) error { <-ctx.Done(); return ctx.Err() })
		if err != nil {
			t.Fatal(err)
		}
		views = append(views, v)
	}
	if _, err := a.startTransfer("workspace", "overflow", "upload", 0, func(context.Context, func(int64, int64)) error { return nil }); err == nil {
		t.Fatal("等待队列超过 32 项")
	}
	for _, v := range views {
		a.CancelTransfer(v.ID)
	}
	for _, v := range views {
		select {
		case <-a.transfers[v.ID].done:
		case <-time.After(3 * time.Second):
			t.Fatal("取消后未释放任务")
		}
	}
}
