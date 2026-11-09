package ssh

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	gossh "golang.org/x/crypto/ssh"
	"golang.org/x/text/encoding/simplifiedchinese"
)

type CommandResult struct {
	Stdout       string `json:"stdout"`
	Stderr       string `json:"stderr"`
	ExitCode     int    `json:"exit_code"`
	DurationMS   int64  `json:"duration_ms"`
	Truncated    bool   `json:"truncated"`
	Error        string `json:"error"`
	StdoutBase64 string `json:"stdout_base64,omitempty"`
	StderrBase64 string `json:"stderr_base64,omitempty"`
}

type commandOutput struct {
	buffer    bytes.Buffer
	limit     int
	truncated bool
}

func (w *commandOutput) String() string { return w.buffer.String() }
func (w *commandOutput) Bytes() []byte  { return w.buffer.Bytes() }

func (w *commandOutput) Write(data []byte) (int, error) {
	n := len(data)
	remaining := w.limit - w.buffer.Len()
	if len(data) > remaining {
		data = data[:remaining]
		w.truncated = true
	}
	w.buffer.Write(data)
	return n, nil
}

func (t *Terminal) RunCommand(ctx context.Context, script string) CommandResult {
	return t.runCommandRequest(ctx, "sh -s", script, "UTF-8")
}

func (t *Terminal) RunScript(ctx context.Context, script, shell, encoding string) CommandResult {
	command := "sh -s"
	switch shell {
	case "sh":
	case "powershell":
		command = powerShellCommand(encoding)
	default:
		return CommandResult{ExitCode: -1, Error: "不支持的脚本解释器"}
	}
	if encoding != "UTF-8" && encoding != "GBK" && encoding != "GB18030" {
		return CommandResult{ExitCode: -1, Error: "不支持的命令输出编码"}
	}
	return t.runCommandRequest(ctx, command, script, encoding)
}

func (t *Terminal) runCommandRequest(ctx context.Context, command, input, encoding string) CommandResult {
	started := time.Now()
	if err := ctx.Err(); err != nil {
		return CommandResult{ExitCode: -1, Error: err.Error()}
	}
	t.mu.Lock()
	if t.commandRequests == nil {
		t.commandRequests = make(chan struct{}, 4)
	}
	slots := t.commandRequests
	t.mu.Unlock()
	select {
	case slots <- struct{}{}:
	default:
		return CommandResult{ExitCode: -1, Error: "SSH 命令未完成请求达到上限"}
	}
	ready := make(chan CommandResult, 1)
	go func() {
		defer func() { <-slots }()
		ready <- t.runCommand(ctx, command, input, encoding)
	}()
	select {
	case result := <-ready:
		return result
	case <-ctx.Done():
		return CommandResult{ExitCode: -1, DurationMS: time.Since(started).Milliseconds(), Error: ctx.Err().Error()}
	}
}

func (t *Terminal) runCommand(ctx context.Context, command, input, encoding string) CommandResult {
	started := time.Now()
	result := CommandResult{ExitCode: -1}
	session, err := t.client.NewSession()
	if err != nil {
		result.Error = err.Error()
		return result
	}
	defer session.Close()
	if ctx.Err() != nil {
		result.Error = ctx.Err().Error()
		return result
	}
	stop := context.AfterFunc(ctx, func() { session.Close() })
	defer stop()
	stdout := &commandOutput{limit: 64 << 10}
	stderr := &commandOutput{limit: 16 << 10}
	session.Stdin = strings.NewReader(input)
	session.Stdout, session.Stderr = stdout, stderr
	err = session.Run(command)
	var stdoutErr, stderrErr error
	result.Stdout, result.StdoutBase64, stdoutErr = decodeCommandOutput(stdout.Bytes(), encoding, stdout.truncated)
	result.Stderr, result.StderrBase64, stderrErr = decodeCommandOutput(stderr.Bytes(), encoding, stderr.truncated)
	result.Truncated = stdout.truncated || stderr.truncated
	result.DurationMS = time.Since(started).Milliseconds()
	if ctx.Err() != nil {
		result.Error = ctx.Err().Error()
		return result
	}
	if err == nil {
		result.ExitCode = 0
	} else {
		var exit *gossh.ExitError
		if errors.As(err, &exit) {
			result.ExitCode = exit.ExitStatus()
		} else {
			result.Error = err.Error()
		}
	}
	if decodeErr := errors.Join(stdoutErr, stderrErr); decodeErr != nil {
		result.Error = strings.TrimSpace(result.Error + "\n" + errors.Join(errors.New("命令输出解码失败，原始字节保存在 base64 字段；请核对输出编码"), decodeErr).Error())
	}
	return result
}

func decodeCommandOutput(data []byte, encoding string, truncated bool) (string, string, error) {
	raw := data
	if encoding == "GBK" || encoding == "GB18030" {
		codec := simplifiedchinese.GBK
		if encoding == "GB18030" {
			codec = simplifiedchinese.GB18030
		}
		decoded, err := codec.NewDecoder().Bytes(data)
		if err == nil {
			encoded, encodeErr := codec.NewEncoder().Bytes(decoded)
			if encodeErr == nil && bytes.Equal(encoded, data) {
				return string(decoded), "", nil
			}
		}
		return "", base64.StdEncoding.EncodeToString(raw), errors.New("输出含无效的 " + encoding + " 字节")
	}
	if truncated && !utf8.Valid(data) {
		start := len(data) - 1
		for start >= 0 && !utf8.RuneStart(data[start]) {
			start--
		}
		if start >= 0 && !utf8.FullRune(data[start:]) {
			data = data[:start]
		}
	}
	if !utf8.Valid(data) {
		return "", base64.StdEncoding.EncodeToString(raw), errors.New("输出不是 UTF-8")
	}
	return string(data), "", nil
}
