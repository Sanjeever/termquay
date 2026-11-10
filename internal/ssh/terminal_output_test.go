package ssh

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestRelayCoalescesProgressWrites(t *testing.T) {
	stream := newStream()
	defer stream.Close()
	output := io.MultiReader(strings.NewReader("\x1b[1G"), strings.NewReader("\x1b[0K"), strings.NewReader("⠼"))
	done := make(chan struct{})
	close(done)
	result := make(chan error, 1)
	go func() {
		result <- RelayIO(io.Discard, output, done, func() {}, func() error { return nil }, nil, stream)
	}()
	select {
	case frame := <-stream.out:
		if string(frame) != "\x1b[1G\x1b[0K⠼" {
			t.Fatalf("partial progress update: %q", frame)
		}
		ack := make([]byte, 5)
		ack[0] = 1
		binary.BigEndian.PutUint32(ack[1:], uint32(len(frame)))
		stream.in <- ack
	case <-time.After(time.Second):
		t.Fatal("progress update was not forwarded")
	}
	select {
	case err := <-result:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("relay did not finish")
	}
}

func TestCoalescedOutputPreservesBoundariesAndReadError(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	failure := errors.New("read failed")
	want := bytes.Repeat([]byte("\x1b[0K中文"), ChunkSize)
	read := coalescedTerminalOutput(ctx, io.MultiReader(bytes.NewReader(want), errorReader{failure}))
	var got []byte
	buffer := make([]byte, ChunkSize)
	for {
		n, err := read(buffer)
		got = append(got, buffer[:n]...)
		if err != nil {
			if !errors.Is(err, failure) {
				t.Fatalf("read error = %v", err)
			}
			break
		}
	}
	if !bytes.Equal(got, want) {
		t.Fatal("coalescing changed output bytes")
	}
}

type errorReader struct{ err error }

func (r errorReader) Read([]byte) (int, error) { return 0, r.err }

func TestCoalescedOutputFlushesWithoutMoreOutputAndCancels(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reader, writer := io.Pipe()
	defer writer.Close()
	stop := context.AfterFunc(ctx, func() { reader.Close() })
	defer stop()
	read := coalescedTerminalOutput(ctx, reader)
	go writer.Write([]byte("prompt"))
	buffer := make([]byte, ChunkSize)
	finished := make(chan struct{})
	var n int
	var err error
	go func() { n, err = read(buffer); close(finished) }()
	select {
	case <-finished:
		if n != 6 || err != nil || string(buffer[:n]) != "prompt" {
			t.Fatalf("output = %q, %v", buffer[:n], err)
		}
	case <-time.After(time.Second):
		t.Fatal("coalescer waited for another write")
	}
	var waiting sync.WaitGroup
	waiting.Add(1)
	go func() { defer waiting.Done(); _, err = read(buffer) }()
	cancel()
	waiting.Wait()
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation = %v", err)
	}
}
