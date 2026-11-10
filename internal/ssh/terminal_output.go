package ssh

import (
	"context"
	"io"
	"time"
)

const terminalOutputBatchDelay = time.Millisecond

type terminalOutputChunk struct {
	data    []byte
	storage []byte
	err     error
}

func coalescedTerminalOutput(ctx context.Context, output io.Reader) func([]byte) (int, error) {
	buffers := make(chan []byte, 2)
	for range cap(buffers) {
		buffers <- make([]byte, ChunkSize)
	}
	chunks := make(chan terminalOutputChunk)
	go func() {
		for {
			var buffer []byte
			select {
			case buffer = <-buffers:
			case <-ctx.Done():
				return
			}
			n, err := output.Read(buffer)
			select {
			case chunks <- terminalOutputChunk{data: buffer[:n], storage: buffer, err: err}:
			case <-ctx.Done():
				return
			}
			if err != nil {
				return
			}
		}
	}()
	var pending terminalOutputChunk
	return func(buffer []byte) (int, error) {
		var chunk terminalOutputChunk
		if pending.storage != nil {
			chunk = pending
			pending = terminalOutputChunk{}
		} else {
			select {
			case chunk = <-chunks:
			case <-ctx.Done():
				return 0, ctx.Err()
			}
		}
		// PTY reads are not screen frames: npm writes erase and replacement bytes separately.
		timer := time.NewTimer(terminalOutputBatchDelay)
		defer timer.Stop()
		n := 0
		for {
			copied := copy(buffer[n:], chunk.data)
			n += copied
			if copied < len(chunk.data) {
				chunk.data = chunk.data[copied:]
				pending = chunk
				return n, nil
			}
			buffers <- chunk.storage
			if chunk.err != nil || n == len(buffer) {
				return n, chunk.err
			}
			select {
			case chunk = <-chunks:
			case <-timer.C:
				return n, nil
			case <-ctx.Done():
				return n, ctx.Err()
			}
		}
	}
}
