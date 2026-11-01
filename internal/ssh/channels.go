package ssh

import (
	"bytes"
	"context"
	"errors"
	"io"

	"github.com/pkg/sftp"
)

func (t *Terminal) FileClient(ctx context.Context) (*sftp.Client, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	client, err := sftp.NewClient(t.client)
	if err != nil {
		return nil, err
	}
	if err = ctx.Err(); err != nil {
		client.Close()
		return nil, err
	}
	return client, nil
}

func (t *Terminal) Exec(ctx context.Context, script string, maxBytes int) ([]byte, error) {
	s, err := t.client.NewSession()
	if err != nil {
		return nil, err
	}
	defer s.Close()
	stop := context.AfterFunc(ctx, func() { s.Close() })
	defer stop()
	s.Stdin = bytes.NewBufferString(script)
	output, err := s.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err = s.Start("sh -s"); err != nil {
		return nil, err
	}
	data, err := io.ReadAll(io.LimitReader(output, int64(maxBytes+1)))
	if err != nil {
		return nil, err
	}
	if len(data) > maxBytes {
		return nil, errors.New("采集输出超过限制")
	}
	if err = s.Wait(); err != nil {
		return nil, err
	}
	return data, nil
}
