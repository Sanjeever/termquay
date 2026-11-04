package app

import (
	"context"
	"encoding/base64"
	"errors"
	"time"

	gossh "golang.org/x/crypto/ssh"
)

type SSHChallenge struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Instruction string   `json:"instruction"`
	Questions   []string `json:"questions"`
	Echo        []bool   `json:"echo"`
}

type sshAuthentication struct {
	challenge *SSHChallenge
	progress  *connectionProgress
	answers   chan []string
	rounds    int
}

func (a *AppService) beginSSHAuthentication(ctx context.Context, id string) (gossh.KeyboardInteractiveChallenge, func(), error) {
	if id == "" {
		return nil, func() {}, nil
	}
	a.mu.Lock()
	if len(id) < 16 || len(id) > 128 || a.closed || len(a.sshChallenges) >= 16 || a.sshChallenges[id] != nil {
		a.mu.Unlock()
		return nil, nil, errors.New("交互认证请求无效或已达到上限")
	}
	if a.sshChallenges == nil {
		a.sshChallenges = make(map[string]*sshAuthentication)
	}
	state := &sshAuthentication{answers: make(chan []string, 1), progress: &connectionProgress{}}
	a.sshChallenges[id] = state
	a.mu.Unlock()
	challenge := func(user, instruction string, questions []string, echo []bool) ([]string, error) {
		size := len(user) + len(instruction)
		for _, q := range questions {
			size += len(q)
		}
		a.mu.Lock()
		if state.rounds >= 16 || len(questions) > 8 || len(questions) != len(echo) || size > 16<<10 || a.closed {
			a.mu.Unlock()
			return nil, errors.New("服务器交互认证提示超出限制")
		}
		state.rounds++
		state.challenge = &SSHChallenge{ID: base64.RawURLEncoding.EncodeToString(randomBytes(24)), Name: user, Instruction: instruction, Questions: append([]string{}, questions...), Echo: append([]bool{}, echo...)}
		a.mu.Unlock()
		timer := time.NewTimer(2 * time.Minute)
		defer timer.Stop()
		select {
		case answers := <-state.answers:
			return answers, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-timer.C:
			return nil, errors.New("等待交互认证超时")
		}
	}
	return challenge, func() {
		a.mu.Lock()
		delete(a.sshChallenges, id)
		a.mu.Unlock()
	}, nil
}

func (a *AppService) GetSSHChallenge(id string) *SSHChallenge {
	a.mu.Lock()
	defer a.mu.Unlock()
	if state := a.sshChallenges[id]; state != nil {
		return state.challenge
	}
	return nil
}

func (a *AppService) AnswerSSHChallenge(id, challengeID string, answers []string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	state := a.sshChallenges[id]
	if state == nil || state.challenge == nil || state.challenge.ID != challengeID || len(answers) != len(state.challenge.Questions) {
		return errors.New("交互认证提示已失效")
	}
	for _, answer := range answers {
		if len(answer) > 4096 {
			return errors.New("认证输入超过 4096 字节")
		}
	}
	select {
	case state.answers <- answers:
		state.challenge = nil
		return nil
	default:
		return errors.New("认证响应已提交")
	}
}

func (a *AppService) OpenSavedTerminalInteractive(ctx context.Context, id, authID string) (OpenResult, error) {
	r, c, err := a.savedRequest(id)
	if err != nil {
		return OpenResult{}, err
	}
	if c.Protocol != "ssh" {
		return OpenResult{}, errors.New("连接协议不是 SSH")
	}
	r.AuthID = authID
	return a.OpenTerminal(ctx, r)
}
