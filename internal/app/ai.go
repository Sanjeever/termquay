package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/Sanjeever/termquay/internal/ai"
	"github.com/Sanjeever/termquay/internal/store"
)

const maxAIRuns = 2
const maxAIToolSteps = 32
const maxAIToolResultBytes = 16 << 10

type AIMessage struct {
	Seq       int        `json:"seq"`
	RunID     string     `json:"run_id"`
	Message   ai.Message `json:"message"`
	State     string     `json:"state"`
	CreatedAt int64      `json:"created_at"`
}

type AIConversationPage struct {
	Conversation  store.AIConversation `json:"conversation"`
	CurrentTarget string               `json:"current_target"`
	Messages      []AIMessage          `json:"messages"`
	HasMore       bool                 `json:"has_more"`
}

type AIPendingApproval struct {
	Token          string      `json:"token"`
	Call           ai.ToolCall `json:"call"`
	TimeoutSeconds int         `json:"timeout_seconds"`
}

type AIToolDecision struct {
	Workspace      string `json:"workspace"`
	RunID          string `json:"run_id"`
	ConversationID string `json:"conversation_id"`
	Token          string `json:"token"`
	CallID         string `json:"call_id"`
	Arguments      string `json:"arguments"`
	TimeoutSeconds int    `json:"timeout_seconds"`
}

type AIRunView struct {
	ID             string             `json:"id"`
	Workspace      string             `json:"workspace"`
	ConversationID string             `json:"conversation_id"`
	State          string             `json:"state"`
	LiveText       string             `json:"live_text"`
	Pending        *AIPendingApproval `json:"pending,omitempty"`
	LastSeq        int                `json:"last_seq"`
	Revision       uint64             `json:"revision"`
	Compressed     bool               `json:"compressed"`
	Error          string             `json:"error"`
}

type AIStartRequest struct {
	Workspace          string         `json:"workspace"`
	ConversationID     string         `json:"conversation_id"`
	Text               string         `json:"text"`
	References         []ai.Reference `json:"references"`
	AcceptTargetChange bool           `json:"accept_target_change"`
}

type aiWorkspaceConversation struct {
	owner *workspaceOwner
	id    string
}
type aiRun struct {
	mu       sync.Mutex
	view     AIRunView
	owner    *workspaceOwner
	config   ai.Config
	ctx      context.Context
	cancel   context.CancelFunc
	done     chan struct{}
	approval chan bool
	rejected map[string]bool
}

func aiID() string { return base64.RawURLEncoding.EncodeToString(randomBytes(18)) }
func aiArchive(owner *workspaceOwner, workspace string) string {
	if owner.connectionID != "" {
		return "connection:" + owner.connectionID
	}
	return "temporary:" + workspace
}

func (a *AppService) aiOwner(workspace string, expected *workspaceOwner) (*workspaceOwner, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	owner := a.workspaces[workspace]
	if workspace == "" || owner == nil || (expected != nil && owner != expected) || a.closed || a.appLocked.Load() || owner.ctx.Err() != nil {
		return nil, errors.New("AI 所属 SSH 实例已断开、变化或应用已锁定")
	}
	return owner, nil
}

func (a *AppService) aiAvailable(workspace string) (*workspaceOwner, error) {
	if a.aiStopped {
		return nil, errors.New("AI 服务已退出")
	}
	owner, err := a.aiOwner(workspace, nil)
	if err != nil {
		return nil, err
	}
	c, err := a.aiConfig()
	if err == nil && !c.Enabled {
		err = errors.New("AI 助手已关闭")
	}
	return owner, err
}

func (a *AppService) cancelAIWork() {
	a.aiMu.Lock()
	defer a.aiMu.Unlock()
	a.cancelAILocked()
}

func (a *AppService) cancelAILocked() {
	for _, run := range a.aiRuns {
		run.cancel()
	}
	for _, cancel := range a.aiTests {
		cancel()
	}
}

func (a *AppService) closeAIWorkspace(workspace string) {
	a.aiMu.Lock()
	defer a.aiMu.Unlock()
	if run := a.aiRuns[workspace]; run != nil {
		run.cancel()
		delete(a.aiRuns, workspace)
	}
	delete(a.aiCurrent, workspace)
}

func (a *AppService) shutdownAI() {
	a.aiMu.Lock()
	a.aiStopped = true
	a.cancelAILocked()
	a.aiMu.Unlock()
	a.aiWorkers.Wait()
}

func (a *AppService) GetAIRun(workspace string) (AIRunView, error) {
	a.aiMu.Lock()
	defer a.aiMu.Unlock()
	if _, err := a.aiAvailable(workspace); err != nil {
		return AIRunView{}, err
	}
	if run := a.aiRuns[workspace]; run != nil {
		return run.snapshot(), nil
	}
	current := a.aiCurrent[workspace]
	return AIRunView{Workspace: workspace, ConversationID: current.id, State: "idle"}, nil
}

func (run *aiRun) snapshot() AIRunView {
	run.mu.Lock()
	defer run.mu.Unlock()
	view := run.view
	if view.Pending != nil {
		pending := *view.Pending
		view.Pending = &pending
	}
	return view
}

func (a *AppService) StopAIRun(workspace, runID string) error {
	a.aiMu.Lock()
	defer a.aiMu.Unlock()
	if a.appLocked.Load() {
		return errors.New("应用已锁定")
	}
	run := a.aiRuns[workspace]
	if run == nil || run.view.ID != runID {
		return errors.New("AI 轮次已失效")
	}
	run.cancel()
	return nil
}

func (a *AppService) StartAIRun(ctx context.Context, request AIStartRequest) (AIRunView, error) {
	if len(request.Text) > ai.MaxInputBytes || len(request.References) > 4 || strings.ContainsRune(request.Text, 0) {
		return AIRunView{}, errors.New("AI 输入或引用超过限制")
	}
	referenceBytes := 0
	for _, r := range request.References {
		if r.Workspace != request.Workspace || len(r.Terminal) > 128 || len(r.Label) > 128 {
			return AIRunView{}, errors.New("终端引用不属于当前工作区")
		}
		referenceBytes += len(r.Text)
	}
	if referenceBytes > ai.MaxReferenceBytes || (strings.TrimSpace(request.Text) == "" && referenceBytes == 0) {
		return AIRunView{}, errors.New("请输入问题；引用总量不能超过限制")
	}
	a.aiMu.Lock()
	defer a.aiMu.Unlock()
	owner, err := a.aiAvailable(request.Workspace)
	if err != nil {
		return AIRunView{}, err
	}
	active := 0
	for workspace, run := range a.aiRuns {
		select {
		case <-run.done:
		default:
			active++
			if workspace == request.Workspace || run.view.ConversationID == request.ConversationID {
				return AIRunView{}, errors.New("当前工作区或对话已有运行轮次")
			}
		}
	}
	if active >= maxAIRuns {
		return AIRunView{}, errors.New("AI 同时运行数量达到上限")
	}
	current := a.aiCurrent[request.Workspace]
	if current.owner != owner || current.id != request.ConversationID || request.ConversationID == "" {
		return AIRunView{}, errors.New("请先打开当前工作区对话")
	}
	config, err := a.aiConfig()
	if err != nil {
		return AIRunView{}, err
	}
	if err := config.Validate(); err != nil {
		return AIRunView{}, err
	}
	a.storeMu.Lock()
	c, err := a.store.AIConversation(ctx, request.ConversationID)
	a.storeMu.Unlock()
	if err != nil {
		return AIRunView{}, err
	}
	if c.Archive != aiArchive(owner, request.Workspace) {
		return AIRunView{}, errors.New("AI 对话不属于当前连接")
	}
	if c.Target != owner.target && !request.AcceptTargetChange {
		return AIRunView{}, errors.New("连接目标已变化，请核对原目标与当前目标")
	}
	if err := ctx.Err(); err != nil {
		return AIRunView{}, err
	}
	runCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Minute)
	stopOwner := context.AfterFunc(owner.ctx, cancel)
	run := &aiRun{owner: owner, config: config, ctx: runCtx, cancel: cancel, done: make(chan struct{}), approval: make(chan bool, 1), rejected: map[string]bool{}}
	run.view = AIRunView{ID: aiID(), Workspace: request.Workspace, ConversationID: c.ID, State: "running", Revision: 1, Compressed: c.SummaryThrough > 0}
	if err := a.repairAITail(run); err != nil {
		cancel()
		stopOwner()
		return AIRunView{}, err
	}
	if _, err := a.persistAIMessage(run, ai.Message{Role: "user", Content: request.Text, References: request.References}, "complete"); err != nil {
		cancel()
		stopOwner()
		return AIRunView{}, err
	}
	if c.Title == "新对话" {
		title := strings.TrimSpace(request.Text)
		if title == "" {
			title = "终端引用"
		}
		c.Title = string([]rune(title)[:min(48, len([]rune(title)))])
		a.storeMu.Lock()
		err = a.store.UpdateAIConversation(ctx, c)
		a.storeMu.Unlock()
		if err != nil {
			cancel()
			stopOwner()
			return AIRunView{}, err
		}
	}
	if a.aiRuns == nil {
		a.aiRuns = map[string]*aiRun{}
	}
	a.aiRuns[request.Workspace] = run
	a.aiWorkers.Add(1)
	go func() { defer a.aiWorkers.Done(); defer stopOwner(); a.executeAIRun(runCtx, run) }()
	return run.snapshot(), nil
}

func (a *AppService) persistAIMessage(run *aiRun, message ai.Message, state string) (AIMessage, error) {
	m := AIMessage{RunID: run.view.ID, Message: message, State: state, CreatedAt: time.Now().UnixMilli()}
	b, err := json.Marshal(m)
	if err != nil {
		return m, err
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(run.ctx), 10*time.Second)
	defer cancel()
	a.storeMu.Lock()
	if a.store == nil {
		err = errors.New("AI 历史存储不可用")
	} else {
		m.Seq, err = a.store.AppendAIMessage(ctx, run.view.ConversationID, string(b))
	}
	a.storeMu.Unlock()
	if err != nil {
		return m, err
	}
	run.mu.Lock()
	run.view.LastSeq = m.Seq
	run.view.Revision++
	run.mu.Unlock()
	return m, nil
}
