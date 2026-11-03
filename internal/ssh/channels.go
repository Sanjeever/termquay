package ssh

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"sync"

	"github.com/pkg/sftp"
	directorysftp "github.com/pkg/sftp/v2"
	gossh "golang.org/x/crypto/ssh"
)

func (t *Terminal) DialAddress(ctx context.Context, address string) (net.Conn, error) {
	return t.client.DialContext(ctx, "tcp", address)
}

func (t *Terminal) DirectoryClient(ctx context.Context) (*directorysftp.Client, error) {
	return directorysftp.NewClient(ctx, t.client, directorysftp.WithMaxInflight(4), directorysftp.WithMaxDataLength(32<<10), directorysftp.WithMaxPacketLength(1<<20))
}

func (t *Terminal) FileClient(ctx context.Context) (*sftp.Client, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	session, err := t.client.NewSession()
	if err != nil {
		return nil, err
	}
	stop := context.AfterFunc(ctx, func() { session.Close() })
	input, err := session.StdinPipe()
	if err != nil {
		stop()
		session.Close()
		return nil, err
	}
	output, err := session.StdoutPipe()
	if err != nil {
		stop()
		session.Close()
		return nil, err
	}
	writer := &sftpWriter{WriteCloser: input, session: session, stop: stop}
	if err = session.RequestSubsystem("sftp"); err != nil {
		writer.Close()
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, err
	}
	client, err := sftp.NewClientPipe(output, writer)
	if err != nil {
		writer.Close()
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, err
	}
	return client, nil
}

type sftpWriter struct {
	io.WriteCloser
	session *gossh.Session
	stop    func() bool
	once    sync.Once
	err     error
}

func (w *sftpWriter) Close() error {
	w.once.Do(func() { w.stop(); w.err = errors.Join(w.session.Close(), w.WriteCloser.Close()) })
	return w.err
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
