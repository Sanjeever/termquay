package main

import (
	"context"
	"testing"
	"time"
)

func TestSSHInteractiveRoundAndCancellation(t *testing.T) {
	a := NewAppService()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	id := "interactive-local-test"
	challenge, release, err := a.beginSSHAuthentication(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	done := make(chan error, 1)
	go func() {
		answers, err := challenge("test", "验证码", []string{"OTP"}, []bool{false})
		if err == nil && (len(answers) != 1 || answers[0] != "local-otp") {
			t.Error("认证答案未传递")
		}
		done <- err
	}()
	deadline := time.After(time.Second)
	var prompt *SSHChallenge
	for prompt == nil {
		select {
		case <-deadline:
			t.Fatal("未收到认证提示")
		case <-time.After(time.Millisecond):
			prompt = a.GetSSHChallenge(id)
		}
	}
	if err := a.AnswerSSHChallenge(id, "stale", []string{"local-otp"}); err == nil {
		t.Fatal("接受了过期认证提示")
	}
	if err := a.AnswerSSHChallenge(id, prompt.ID, []string{"local-otp"}); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if err := a.AnswerSSHChallenge(id, prompt.ID, []string{"local-otp"}); err == nil {
		t.Fatal("接受了重复答案")
	}
	cancel()
	if _, err := challenge("test", "", []string{"OTP"}, []bool{false}); err == nil {
		t.Fatal("取消后仍在等待认证")
	}
	release()
	if a.GetSSHChallenge(id) != nil {
		t.Fatal("认证提示未清理")
	}
}
