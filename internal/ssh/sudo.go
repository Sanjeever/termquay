package ssh

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	"io"
	"strings"
	"sync"
)

type sudoPromptWriter struct {
	buffer   bytes.Buffer
	prompt   []byte
	input    io.Writer
	password string
	sent     bool
}

func (w *sudoPromptWriter) Write(data []byte) (int, error) {
	n := len(data)
	if w.buffer.Len()+len(data) > 16<<10 {
		return 0, appmessage.New("backend:sudoStderrExceedsTheLimit", "sudo 错误输出超过限制")
	}
	w.buffer.Write(data)
	if bytes.Contains(w.buffer.Bytes(), w.prompt) {
		clean := bytes.ReplaceAll(w.buffer.Bytes(), w.prompt, nil)
		w.buffer.Reset()
		w.buffer.Write(clean)
		if w.sent {
			return 0, appmessage.New("backend:sudoAuthenticationFailedAuthorizeAgain", "sudo 认证失败，请重新授权")
		}
		w.sent = true
		_, err := io.WriteString(w.input, w.password+"\n")
		return n, err
	}
	return n, nil
}

type sudoReadyWriter struct {
	buffer     commandOutput
	ready      []byte
	prefix     []byte
	once       sync.Once
	writeInput func()
	started    bool
}

func (w *sudoReadyWriter) Write(data []byte) (int, error) {
	n := len(data)
	if !w.started {
		w.prefix = append(w.prefix, data...)
		if len(w.prefix) < len(w.ready) {
			return n, nil
		}
		if !bytes.HasPrefix(w.prefix, w.ready) {
			return 0, appmessage.New("backend:sudoWriteChannelIsNotReady", "sudo 写入通道未就绪")
		}
		w.started = true
		data = w.prefix[len(w.ready):]
		w.prefix = nil
		w.once.Do(w.writeInput)
	}
	_, err := w.buffer.Write(data)
	return n, err
}

func quoteCommandArgument(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}

func (t *Terminal) Sudo(ctx context.Context, script, password string, payload []byte, limit int) ([]byte, error) {
	if len(password) > 4096 || strings.ContainsAny(password, "\x00\r\n") {
		return nil, appmessage.New("backend:invalidSudoPasswordFormat", "sudo 密码格式无效")
	}
	var token [16]byte
	if _, err := rand.Read(token[:]); err != nil {
		return nil, err
	}
	marker := "termquay-" + hex.EncodeToString(token[:])
	session, err := t.client.NewSession()
	if err != nil {
		return nil, err
	}
	defer session.Close()
	stop := context.AfterFunc(ctx, func() { session.Close() })
	defer stop()
	input, err := session.StdinPipe()
	if err != nil {
		return nil, err
	}
	defer input.Close()
	stderr := &sudoPromptWriter{prompt: []byte(marker + ":"), input: input, password: password}
	session.Stderr = stderr
	stdout := &commandOutput{limit: limit}
	session.Stdout = stdout
	written := make(chan error, 1)
	var ready *sudoReadyWriter
	if payload != nil {
		ready = &sudoReadyWriter{buffer: commandOutput{limit: limit}, ready: []byte(marker + "\n"), writeInput: func() {
			go func() { _, err := io.Copy(input, bytes.NewReader(payload)); written <- errors.Join(err, input.Close()) }()
		}}
		session.Stdout = ready
		script = "printf '%s\\n' " + quoteCommandArgument(marker) + "\n" + script
	}
	err = session.Run("sudo -S -k -p " + quoteCommandArgument(marker+":") + " -- sh -c " + quoteCommandArgument(script))
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if err != nil {
		return nil, appmessage.Errorf("backend:sudoOperationFailed", "sudo 操作失败: %w %s", err, strings.TrimSpace(stderr.buffer.String()))
	}
	if ready != nil {
		if !ready.started {
			return nil, appmessage.New("backend:sudoDidNotEstablishAWriteChannel", "sudo 未建立写入通道")
		}
		if err := <-written; err != nil {
			return nil, err
		}
		stdout = &ready.buffer
	}
	if stdout.truncated {
		return nil, appmessage.New("backend:sudoFileOutputExceedsTheLimit", "sudo 文件输出超过限制")
	}
	return stdout.Bytes(), nil
}
