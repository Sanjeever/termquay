package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"testing"
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
