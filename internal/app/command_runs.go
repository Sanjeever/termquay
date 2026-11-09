package app

import (
	"context"
	"encoding/base64"

	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"github.com/wailsapp/wails/v3/pkg/application"
)

const maxCommandRuns = 8
const maxCommandRunOutput = 4 << 20

type CommandRunTarget struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Address      string `json:"address"`
	ConnectionID string `json:"connection_id,omitempty"`
	Identity     string `json:"identity,omitempty"`
}

type CommandRunItem struct {
	Target       CommandRunTarget        `json:"target"`
	Index        int                     `json:"index"`
	Step         string                  `json:"step"`
	State        string                  `json:"state"`
	StateCode    string                  `json:"state_code"`
	Result       *terminal.CommandResult `json:"result,omitempty"`
	Check        *InspectionCheckResult  `json:"check,omitempty"`
	Baseline     string                  `json:"baseline,omitempty"`
	Error        string                  `json:"error,omitempty"`
	ErrorMessage *appmessage.Descriptor  `json:"error_message,omitempty"`
	Revision     uint64                  `json:"revision"`
}

type CommandRunSummary struct {
	ID           string                 `json:"id"`
	Name         string                 `json:"name"`
	State        string                 `json:"state"`
	StateCode    string                 `json:"state_code"`
	StartedAt    int64                  `json:"started_at"`
	FinishedAt   int64                  `json:"finished_at"`
	Completed    int                    `json:"completed"`
	Total        int                    `json:"total"`
	Error        string                 `json:"error,omitempty"`
	ErrorMessage *appmessage.Descriptor `json:"error_message,omitempty"`
	Saved        bool                   `json:"saved"`
	Revision     uint64                 `json:"revision"`
}

type CommandRunRecord struct {
	Summary CommandRunSummary `json:"summary"`
	Task    CommandTask       `json:"task"`
	Results []CommandRunItem  `json:"results"`
}

type commandRun struct {
	view     CommandRunRecord
	cancel   context.CancelFunc
	done     chan struct{}
	approval chan bool
	bytes    int
}

func (a *AppService) StartCommandRun(ctx context.Context, task CommandTask, targets []CommandRunTarget, baselineWorkspace string) (CommandRunSummary, error) {
	task.Name = strings.TrimSpace(task.Name)
	if task.Name == "" {
		task.Name = "临时任务"
	}
	if err := validateCommandTask(task); err != nil {
		return CommandRunSummary{}, err
	}
	if len(targets) == 0 || len(targets) > 64 {
		return CommandRunSummary{}, appmessage.New("backend:selectFrom1To64SSHWorkspacesPer", "每次需选择 1 至 64 个 SSH 工作区")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closed || len(a.commandRuns) >= maxCommandRuns {
		return CommandRunSummary{}, appmessage.New("backend:taskHistoryLimitReached8RemoveFinishedRecords", "任务记录达到上限（8 项），请移除已结束记录后重试")
	}
	active := 0
	for _, run := range a.commandRuns {
		if run.view.Summary.FinishedAt == 0 {
			active++
		}
	}
	if active >= 2 {
		return CommandRunSummary{}, appmessage.New("backend:upToTwoMultiHostTasksCanRun", "最多同时运行两个多主机任务")
	}
	seen := map[string]bool{}
	for i, target := range targets {
		owner := a.workspaces[target.ID]
		if owner == nil || seen[target.ID] || len(target.Name) > 128 {
			return CommandRunSummary{}, appmessage.New("backend:selectedSSHWorkspaceClosedDuplicatedOrNameOversized", "所选 SSH 工作区已关闭、重复或名称超限")
		}
		if err := owner.ctx.Err(); err != nil {
			return CommandRunSummary{}, appmessage.New("backend:selectedSSHWorkspaceDisconnected", "所选 SSH 工作区已断开")
		}
		seen[target.ID] = true
		targets[i].Address = owner.target
		targets[i].Identity = owner.identity
		if target.Name == "" {
			targets[i].Name = owner.target
		}
	}
	for _, step := range task.Steps {
		if step.Check != nil && step.Check.Kind == "file" && a.workspaces[baselineWorkspace] == nil {
			return CommandRunSummary{}, appmessage.New("backend:selectAConnectedBaselineHost", "请选择已连接的基线主机")
		}
	}
	if err := ctx.Err(); err != nil {
		return CommandRunSummary{}, err
	}
	runCtx, cancel := context.WithCancel(context.WithoutCancel(ctx))
	run := &commandRun{cancel: cancel, done: make(chan struct{}), approval: make(chan bool, 1)}
	run.view = CommandRunRecord{Summary: CommandRunSummary{ID: base64.RawURLEncoding.EncodeToString(randomBytes(16)), Name: task.Name, State: "执行中", StartedAt: time.Now().UnixMilli(), Total: len(targets) * len(task.Steps), Revision: 1}, Task: task, Results: []CommandRunItem{}}
	for _, target := range targets {
		for index, step := range task.Steps {
			run.view.Results = append(run.view.Results, CommandRunItem{Target: target, Index: index, Step: step.Name, State: "等待"})
		}
	}
	if a.commandRuns == nil {
		a.commandRuns = map[string]*commandRun{}
	}
	a.commandRuns[run.view.Summary.ID] = run
	run.view = commandRecordWithStateCodes(run.view)
	go a.executeCommandRun(runCtx, run, targets, baselineWorkspace)
	return run.view.Summary, nil
}

func (a *AppService) commandRunChangedLocked(run *commandRun) {
	run.view.Summary.StateCode = commandStateCode(run.view.Summary.State)
	run.view.Summary.Revision++
	application.Get().Event.Emit("command-run:changed", run.view.Summary)
}

func (a *AppService) commandRunItemChangedLocked(run *commandRun, index int) {
	run.view.Results[index].StateCode = commandStateCode(run.view.Results[index].State)
	a.commandRunChangedLocked(run)
	run.view.Results[index].Revision = run.view.Summary.Revision
	application.Get().Event.Emit("command-run:item", struct {
		ID   string         `json:"id"`
		Item CommandRunItem `json:"item"`
	}{run.view.Summary.ID, run.view.Results[index]})
}

func (a *AppService) executeCommandRun(ctx context.Context, run *commandRun, targets []CommandRunTarget, baselineWorkspace string) {
	defer close(run.done)
	defer run.cancel()
	var failed, halted atomic.Bool
	var runError string
	var runMessage *appmessage.Descriptor
	defer func() {
		a.mu.Lock()
		defer a.mu.Unlock()
		for i := range run.view.Results {
			if run.view.Results[i].State == "等待" {
				run.view.Results[i].State = "未执行"
			}
		}
		summary := &run.view.Summary
		summary.FinishedAt = time.Now().UnixMilli()
		summary.Error = runError
		summary.ErrorMessage = runMessage
		switch {
		case ctx.Err() != nil:
			summary.State = "已取消"
		case failed.Load() || runError != "":
			summary.State = "失败"
		default:
			summary.State = "已完成"
		}
		a.commandRunChangedLocked(run)
	}()
	task := run.view.Task
	baselines := make(map[int]*InspectionBaseline)
	for index, step := range task.Steps {
		if step.Check == nil || step.Check.Kind != "file" {
			continue
		}
		baseline, err := a.PrepareInspectionBaseline(ctx, baselineWorkspace, step.Check.FilePath, step.TimeoutSeconds)
		if err != nil {
			runError = err.Error()
			runMessage = appmessage.Describe(err)
			return
		}
		baselines[index] = &baseline
	}
	concurrency, batchSize := task.Concurrency, task.BatchSize
	if concurrency == 0 {
		concurrency = 3
	}
	if batchSize == 0 {
		batchSize = len(targets)
	}
	for start := 0; start < len(targets) && ctx.Err() == nil && !halted.Load(); {
		end := min(len(targets), start+batchSize)
		first := start == 0 && task.FirstHostApproval
		if first {
			end = 1
		}
		var cursor atomic.Int64
		cursor.Store(int64(start))
		var workers sync.WaitGroup
		for range min(concurrency, end-start) {
			workers.Go(func() {
				for ctx.Err() == nil && !halted.Load() {
					targetIndex := int(cursor.Add(1) - 1)
					if targetIndex >= end {
						return
					}
					for index, step := range task.Steps {
						if ctx.Err() != nil {
							return
						}
						itemIndex := targetIndex*len(task.Steps) + index
						a.mu.Lock()
						if run.bytes >= maxCommandRunOutput {
							halted.Store(true)
							failed.Store(true)
							a.mu.Unlock()
							return
						}
						item := run.view.Results[itemIndex]
						item.State = "执行中"
						run.view.Results[itemIndex] = item
						a.commandRunItemChangedLocked(run, itemIndex)
						a.mu.Unlock()
						result, err := a.RunCommandStep(ctx, targets[targetIndex].ID, step, baselines[index])
						item.Result, item.Check = result.Command, result.Check
						if err != nil {
							item.Error = err.Error()
							item.ErrorMessage = appmessage.Describe(err)
							if step.Check != nil {
								item.Check = &InspectionCheckResult{State: "unknown", Message: err.Error()}
							}
						}
						if baseline := baselines[index]; baseline != nil {
							item.Baseline = baseline.Workspace + " · " + baseline.Path + " · " + baseline.Revision
						}
						stepFailed := err != nil || item.Check != nil && item.Check.State != "pass" || item.Check == nil && (item.Result == nil || item.Result.Error != "" || item.Result.ExitCode != 0)
						switch {
						case item.Check != nil:
							item.State = map[string]string{"pass": "通过", "fail": "不通过", "unknown": "无法判定"}[item.Check.State]
						case item.Result != nil && item.Result.Error == "" && item.Result.ExitCode != 0:
							item.State = "非零退出"
						case stepFailed:
							item.State = "失败"
						default:
							item.State = "完成"
						}
						if ctx.Err() != nil {
							item.State = "已请求取消"
						}
						a.mu.Lock()
						if item.Result != nil {
							run.bytes += len(item.Result.Stdout) + len(item.Result.Stderr)
						}
						run.view.Results[itemIndex] = item
						run.view.Summary.Completed++
						a.commandRunItemChangedLocked(run, itemIndex)
						a.mu.Unlock()
						if stepFailed {
							failed.Store(true)
							if task.StopAllOnFailure {
								halted.Store(true)
							}
							if task.StopOnFailure {
								break
							}
						}
					}
				}
			})
		}
		workers.Wait()
		start = end
		if first && start < len(targets) && !halted.Load() && ctx.Err() == nil {
			a.mu.Lock()
			run.view.Summary.State = "等待确认"
			a.commandRunChangedLocked(run)
			a.mu.Unlock()
			select {
			case <-ctx.Done():
				return
			case <-run.approval:
			}
		}
	}
	a.mu.Lock()
	if run.bytes >= maxCommandRunOutput && run.view.Summary.Completed < run.view.Summary.Total {
		runError = "任务输出达到 4 MiB 上限，后续步骤已停止；请缩小执行范围或命令输出"
		runMessage = appmessage.Describe(appmessage.New("backend:runOutputLimit", runError))
	}
	a.mu.Unlock()
}

func (a *AppService) ContinueCommandRun(id string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	run := a.commandRuns[id]
	if run == nil || run.view.Summary.State != "等待确认" {
		return appmessage.New("backend:taskIsNotAwaitingFirstHostConfirmation", "任务当前未等待首台确认")
	}
	run.view.Summary.State = "执行中"
	run.approval <- true
	a.commandRunChangedLocked(run)
	return nil
}

func (a *AppService) CancelCommandRun(id string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	run := a.commandRuns[id]
	if run == nil || run.view.Summary.FinishedAt != 0 {
		return appmessage.New("backend:taskDoesNotExistOrHasFinished", "任务不存在或已结束")
	}
	run.cancel()
	return nil
}

func sortCommandRuns(items []CommandRunSummary) {
	sort.Slice(items, func(i, j int) bool { return items[i].StartedAt > items[j].StartedAt })
}
