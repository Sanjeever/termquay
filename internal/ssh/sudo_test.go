package ssh

import (
	"bytes"
	"testing"
)

func TestSudoPromptDoesNotSendUnrequestedPassword(t *testing.T) {
	var input bytes.Buffer
	w := &sudoPromptWriter{prompt: []byte("unique-prompt:"), input: &input, password: "test-only"}
	if _, err := w.Write([]byte("sudo warning\nunique-")); err != nil {
		t.Fatal(err)
	}
	if input.Len() != 0 {
		t.Fatal("收到完整认证提示前发送了密码")
	}
	if _, err := w.Write([]byte("prompt:")); err != nil {
		t.Fatal(err)
	}
	if input.String() != "test-only\n" || bytes.Contains(w.buffer.Bytes(), w.prompt) {
		t.Fatal("认证提示处理无效")
	}
	if _, err := w.Write(w.prompt); err == nil {
		t.Fatal("重复认证提示应拒绝")
	}
	if input.String() != "test-only\n" {
		t.Fatal("重复发送了密码")
	}
}

func TestSudoPayloadWaitsForReady(t *testing.T) {
	started := 0
	w := &sudoReadyWriter{buffer: commandOutput{limit: 100}, ready: []byte("ready\n"), writeInput: func() { started++ }}
	if _, err := w.Write([]byte("rea")); err != nil {
		t.Fatal(err)
	}
	if started != 0 {
		t.Fatal("就绪前发送了文件正文")
	}
	if _, err := w.Write([]byte("dy\nrevision\ncontent")); err != nil {
		t.Fatal(err)
	}
	if started != 1 || w.buffer.String() != "revision\ncontent" {
		t.Fatal("就绪帧混入了文件正文")
	}
}
