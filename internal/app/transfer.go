package app

import (
	"context"
	"encoding/base64"
	"errors"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	remotefiles "github.com/Sanjeever/termquay/internal/files"
	appmessage "github.com/Sanjeever/termquay/internal/message"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type Transfer struct {
	ID               string                 `json:"id"`
	Workspace        string                 `json:"workspace"`
	Name             string                 `json:"name"`
	Direction        string                 `json:"direction"`
	State            string                 `json:"state"`
	Total            int64                  `json:"total"`
	Completed        int64                  `json:"completed"`
	Error            string                 `json:"error"`
	ErrorMessage     *appmessage.Descriptor `json:"error_message,omitempty"`
	Sequence         uint64                 `json:"sequence"`
	Retryable        bool                   `json:"retryable"`
	Target           string                 `json:"target"`
	SourcePath       string                 `json:"source_path"`
	DestinationPath  string                 `json:"destination_path"`
	Resumable        bool                   `json:"resumable"`
	CleanupRequired  bool                   `json:"cleanup_required"`
	ResumePersisted  bool                   `json:"resume_persisted"`
	TemporaryPath    string                 `json:"temporary_path,omitempty"`
	BatchID          string                 `json:"batch_id"`
	Phase            string                 `json:"phase"`
	Speed            int64                  `json:"speed"`
	RemainingSeconds int64                  `json:"remaining_seconds"`
	Directory        bool                   `json:"directory"`
}
type transferTask struct {
	view           Transfer
	cancel         context.CancelFunc
	done           chan struct{}
	ctx            context.Context
	run            func(context.Context, func(int64, int64)) error
	spec           *transferSpec
	resume         *transferResume
	peerIdentity   string
	resumeClaimed  bool
	cleanupStaging string
}
type transferSpec struct {
	workspace, local, remote, direction string
	overwrite                           bool
	syncPlanID                          string
	batchID                             string
	resume                              *transferResume
}

var errTransferSkipped = appmessage.New("backend:skippedDestinationWithMatchingName", "同名目标已跳过")

type transferExpectation struct {
	source, target remotefiles.SyncNode
	targetExists   bool
}

func checkTransferExpectation(source, target os.FileInfo, expected []transferExpectation) error {
	if len(expected) == 0 {
		return nil
	}
	value := expected[0]
	if !remotefiles.SameSyncNode(remotefiles.SyncInfo(source), value.source) {
		return appmessage.New("backend:sourceFileChangedAfterPreview", "源文件自预览后已变化")
	}
	if value.targetExists {
		if target == nil || !remotefiles.SameSyncNode(remotefiles.SyncInfo(target), value.target) {
			return appmessage.New("backend:destinationChangedAfterPreview", "目标自预览后已变化")
		}
	} else if target != nil {
		return appmessage.New("backend:destinationAppearedAfterPreview", "目标自预览后已出现")
	}
	return nil
}

type TransferBatch struct {
	Items  []Transfer `json:"items"`
	Errors []string   `json:"errors"`
}

func init() {
	application.RegisterEvent[Transfer]("transfer:changed")
	application.RegisterEvent[UploadPreparation]("files:upload-prepared")
}

func (a *AppService) ListTransfers() []Transfer {
	a.mu.Lock()
	defer a.mu.Unlock()
	result := make([]Transfer, 0, len(a.transfers))
	for _, task := range a.transfers {
		result = append(result, task.view)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Sequence < result[j].Sequence })
	return result
}
func (a *AppService) CancelTransfer(id string) {
	a.mu.Lock()
	task := a.transfers[id]
	queuedResume := task != nil && task.view.State == "queued" && task.resume != nil
	if task != nil {
		a.cancelTransferLocked(task)
	}
	a.mu.Unlock()
	if queuedResume {
		if err := a.persistTransferResumes(); err != nil {
			a.mu.Lock()
			task.view.Error = "续传记录保存失败：" + err.Error()
			task.view.ErrorMessage = appmessage.Describe(appmessage.Errorf("backend:resumeRecordSaveFailed", "续传记录保存失败：%w", err))
			a.transferEvent(task.view)
			a.mu.Unlock()
		}
	}
}
func (a *AppService) cancelTransferLocked(task *transferTask) {
	task.cancel()
	if task.view.State != "queued" {
		if task.view.State == "running" {
			task.view.Phase = "cancelling"
			task.view.Speed, task.view.RemainingSeconds = 0, -1
			a.transferEvent(task.view)
		}
		return
	}
	task.view.State = "cancelled"
	task.view.Resumable = task.resume != nil
	if task.resume != nil {
		task.view.TemporaryPath = task.resume.temporary
	}
	if task.spec != nil && task.spec.syncPlanID != "" {
		delete(a.syncPlans, task.spec.syncPlanID)
	}
	task.run = nil
	for i, id := range a.transferQueue {
		if id == task.view.ID {
			a.transferQueue = append(a.transferQueue[:i], a.transferQueue[i+1:]...)
			break
		}
	}
	close(task.done)
	a.transferEvent(task.view)
}
func (a *AppService) ClearTransfer(id string) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	task := a.transfers[id]
	if task == nil {
		return id, nil
	}
	if task.resume != nil || task.cleanupStaging != "" || task.resumeClaimed || task.view.State == "running" || task.view.State == "queued" {
		return "", appmessage.New("backend:cancelTheTransferAndHandleRetainedTemporaryFiles", "请先取消传输并处理保留的临时文件")
	}
	delete(a.transfers, id)
	return id, nil
}

func (a *AppService) CancelAndDiscardTransfer(ctx context.Context, id, workspace string) error {
	a.mu.Lock()
	task := a.transfers[id]
	a.mu.Unlock()
	if task == nil {
		return appmessage.New("backend:transferTaskDoesNotExist", "传输任务不存在")
	}
	a.CancelTransfer(id)
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-task.done:
	}
	a.mu.Lock()
	retained := task.resume != nil || task.cleanupStaging != ""
	a.mu.Unlock()
	if retained {
		return a.DiscardTransferResume(id, workspace)
	}
	_, err := a.ClearTransfer(id)
	return err
}

func (a *AppService) ClearFinishedTransfers() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	removed := []string{}
	for id, task := range a.transfers {
		if task.resume != nil || task.cleanupStaging != "" || task.resumeClaimed {
			continue
		}
		switch task.view.State {
		case "done", "cancelled", "failed", "skipped":
			delete(a.transfers, id)
			removed = append(removed, id)
		}
	}
	return removed
}

func (a *AppService) startTransfer(workspace, name, direction string, total int64, run func(context.Context, func(int64, int64)) error, specification ...transferSpec) (Transfer, error) {
	a.mu.Lock()
	if a.workspaces[workspace] == nil || a.closed || len(a.transferQueue) >= 32 || len(a.transfers) >= 100 {
		a.mu.Unlock()
		return Transfer{}, appmessage.New("backend:workspaceClosedOrTransferLimitReached2Parallel", "工作区已关闭，或传输任务达到上限（并行 2 个，等待 32 个，历史 100 个）")
	}
	ctx, cancel := context.WithCancel(context.Background())
	id := base64.RawURLEncoding.EncodeToString(randomBytes(16))
	a.transferSequence++
	view := Transfer{ID: id, Workspace: workspace, Name: name, Direction: direction, State: "queued", Total: total, Sequence: a.transferSequence, Target: a.workspaces[workspace].target, RemainingSeconds: -1}
	task := &transferTask{view: view, cancel: cancel, done: make(chan struct{}), ctx: ctx, run: run, peerIdentity: a.workspaces[workspace].identity}
	if len(specification) > 0 {
		spec := specification[0]
		task.spec = &spec
		task.view.Directory = spec.direction == "sync"
		task.view.BatchID = spec.batchID
		task.resume = spec.resume
		if spec.resume != nil {
			task.view.Completed = spec.resume.offset
		}
		task.view.Retryable = spec.direction == "upload" || spec.direction == "download"
		if direction == "upload" {
			task.view.SourcePath = spec.local
			task.view.DestinationPath = spec.remote
		} else {
			task.view.SourcePath = spec.remote
			task.view.DestinationPath = spec.local
		}
	}
	a.transfers[id] = task
	a.transferQueue = append(a.transferQueue, id)
	a.transferEvent(task.view)
	a.dispatchTransfersLocked()
	view = task.view
	a.mu.Unlock()
	return view, nil
}

func (a *AppService) dispatchTransfersLocked() {
	running := 0
	for _, task := range a.transfers {
		if task.view.State == "running" {
			running++
		}
	}
	for !a.closed && running < 2 && len(a.transferQueue) > 0 {
		id := a.transferQueue[0]
		a.transferQueue = a.transferQueue[1:]
		task := a.transfers[id]
		task.view.State = "running"
		task.view.Phase = "preparing"
		a.transferEvent(task.view)
		running++
		go a.runTransfer(task)
	}
}
func (a *AppService) runTransfer(task *transferTask) {
	defer task.cancel()
	a.mu.Lock()
	meter := transferMeter{}
	meter.sample(time.Now(), task.view.Completed)
	a.mu.Unlock()
	last := time.Time{}
	report := func(completed, total int64) {
		a.mu.Lock()
		task.view.Completed = completed
		task.view.Total = total
		if task.ctx.Err() == nil {
			task.view.Phase = "copying"
			if completed >= total {
				task.view.Phase = "finishing"
				task.view.Speed, task.view.RemainingSeconds = 0, -1
			}
		}
		if time.Since(last) >= 150*time.Millisecond {
			last = time.Now()
			a.transferEvent(task.view)
		}
		a.mu.Unlock()
	}
	result := make(chan error, 1)
	go func() { result <- task.run(context.WithValue(task.ctx, transferContextKey{}, task), report) }()
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	var err error
sampling:
	for {
		select {
		case err = <-result:
			break sampling
		case <-ticker.C:
			a.mu.Lock()
			speed := meter.sample(time.Now(), task.view.Completed)
			task.view.Speed, task.view.RemainingSeconds = 0, -1
			if task.view.Phase == "copying" {
				task.view.Speed = speed
				if speed > 0 && task.view.Total > task.view.Completed {
					task.view.RemainingSeconds = (task.view.Total-task.view.Completed-1)/speed + 1
				}
			}
			a.transferEvent(task.view)
			a.mu.Unlock()
		}
	}
	a.mu.Lock()
	if errors.Is(err, errTransferSkipped) {
		task.view.State = "skipped"
	} else if err == nil {
		task.view.State = "done"
	} else if task.ctx.Err() != nil {
		task.view.State = "cancelled"
		task.view.Error = err.Error()
		task.view.ErrorMessage = appmessage.Describe(err)
	} else {
		task.view.State = "failed"
		task.view.Error = err.Error()
		task.view.ErrorMessage = appmessage.Describe(err)
	}
	if errors.Is(err, errTransferSkipped) {
		task.view.Error = err.Error()
		task.view.ErrorMessage = appmessage.Describe(err)
	}
	task.view.Phase = ""
	task.view.Speed, task.view.RemainingSeconds = 0, -1
	task.run = nil
	task.view.Resumable = task.resume != nil
	if task.resume != nil {
		task.view.TemporaryPath = task.resume.temporary
	}
	if task.spec != nil && task.spec.syncPlanID != "" {
		delete(a.syncPlans, task.spec.syncPlanID)
	}
	a.transferEvent(task.view)
	a.dispatchTransfersLocked()
	a.mu.Unlock()
	if persistErr := a.persistTransferResumes(); persistErr != nil {
		a.mu.Lock()
		if a.transfers[task.view.ID] == task {
			task.view.Error = strings.TrimSpace(task.view.Error + "\n续传记录保存失败：" + persistErr.Error())
			task.view.ErrorMessage = appmessage.Join(task.view.ErrorMessage, appmessage.Describe(appmessage.Errorf("backend:resumeRecordSaveFailed", "续传记录保存失败：%w", persistErr)))
			a.transferEvent(task.view)
		}
		a.mu.Unlock()
	}
	close(task.done)
}

type transferWriter struct {
	ctx       context.Context
	writer    io.Writer
	completed int64
	total     int64
	report    func(int64, int64)
	limit     func() int64
}

func (w *transferWriter) Write(data []byte) (int, error) {
	if err := w.ctx.Err(); err != nil {
		return 0, err
	}
	if w.limit != nil {
		if rate := w.limit(); rate > 0 {
			timer := time.NewTimer(time.Duration(int64(len(data)) * int64(time.Second) / rate))
			select {
			case <-timer.C:
			case <-w.ctx.Done():
				timer.Stop()
				return 0, w.ctx.Err()
			}
		}
	}
	n, err := w.writer.Write(data)
	w.completed += int64(n)
	w.report(w.completed, w.total)
	return n, err
}

func (a *AppService) RetryTransfer(id, newName string, overwrite bool) (Transfer, error) {
	a.mu.Lock()
	task := a.transfers[id]
	if task == nil || task.spec == nil || !task.view.Retryable || (task.view.State != "failed" && task.view.State != "cancelled" && task.view.State != "skipped") {
		a.mu.Unlock()
		return Transfer{}, appmessage.New("backend:thisTaskCannotBeRetried", "此任务不能重试")
	}
	spec := *task.spec
	a.mu.Unlock()
	if newName != "" {
		if newName == "." || newName == ".." || strings.ContainsAny(newName, "/\\\x00\r\n:") {
			return Transfer{}, appmessage.New("backend:invalidNewFilename", "新文件名无效")
		}
		if spec.direction == "upload" {
			spec.remote = path.Join(path.Dir(spec.remote), newName)
		} else {
			spec.local = filepath.Join(filepath.Dir(spec.local), newName)
		}
	}
	if spec.direction == "upload" {
		return a.uploadPath(spec.workspace, spec.local, spec.remote, overwrite)
	}
	return a.downloadPath(spec.workspace, spec.remote, spec.local, overwrite)
}
