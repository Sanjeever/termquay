package app

import (
	"encoding/base64"
	"encoding/json"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"github.com/wailsapp/wails/v3/pkg/application"
	"os"
	"strings"
	"time"
)

type CommandStep struct {
	Name           string        `json:"name"`
	Script         string        `json:"script"`
	TimeoutSeconds int           `json:"timeout_seconds"`
	Check          *CommandCheck `json:"check,omitempty"`
}

type CommandTask struct {
	ID                string        `json:"id"`
	Name              string        `json:"name"`
	Steps             []CommandStep `json:"steps"`
	StopOnFailure     bool          `json:"stop_on_failure"`
	Concurrency       int           `json:"concurrency,omitempty"`
	BatchSize         int           `json:"batch_size,omitempty"`
	FirstHostApproval bool          `json:"first_host_approval,omitempty"`
	StopAllOnFailure  bool          `json:"stop_all_on_failure,omitempty"`
}

func (a *AppService) commandTasks() ([]CommandTask, error) {
	if err := a.openStorage(); err != nil {
		return nil, err
	}
	value, err := a.store.SecretSetting("command_tasks")
	if err != nil {
		return nil, err
	}
	if len(value) > 1<<20 {
		return nil, appmessage.New("backend:commandTaskStorageExceeds1MiB", "命令任务存储超过 1 MiB")
	}
	result := []CommandTask{}
	if value != "" {
		err = json.Unmarshal([]byte(value), &result)
	}
	return result, err
}

func (a *AppService) ListCommandTasks() ([]CommandTask, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	return a.commandTasks()
}

func (a *AppService) SaveCommandTask(task CommandTask) (CommandTask, error) {
	task.Name = strings.TrimSpace(task.Name)
	if err := validateCommandTask(task); err != nil {
		return CommandTask{}, err
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	items, err := a.commandTasks()
	if err != nil {
		return CommandTask{}, err
	}
	if task.ID == "" {
		if len(items) >= 64 {
			return CommandTask{}, appmessage.New("backend:commandTaskLimitReached64", "命令任务达到 64 项上限")
		}
		task.ID = base64.RawURLEncoding.EncodeToString(randomBytes(16))
		items = append(items, task)
	} else {
		found := false
		for i := range items {
			if items[i].ID == task.ID {
				items[i] = task
				found = true
				break
			}
		}
		if !found {
			return CommandTask{}, appmessage.New("backend:commandTaskDoesNotExist", "命令任务不存在")
		}
	}
	data, err := json.Marshal(items)
	if err != nil {
		return CommandTask{}, err
	}
	if len(data) > 1<<20 {
		return CommandTask{}, appmessage.New("backend:commandTasksExceed1MiBInTotal", "命令任务总量超过 1 MiB")
	}
	if err = a.store.SetSecretSetting("command_tasks", string(data)); err != nil {
		return CommandTask{}, err
	}
	return task, nil
}

func validateCommandTask(task CommandTask) error {
	if task.Concurrency < 0 || task.Concurrency > 3 || task.BatchSize < 0 || task.BatchSize > 64 {
		return appmessage.New("backend:concurrencyMustBeFrom1To3And", "并发须为 1 至 3，批次大小须为 1 至 64；0 沿用默认值")
	}
	if task.Name == "" || len(task.Name) > 128 || len(task.Steps) == 0 || len(task.Steps) > 16 {
		return appmessage.New("backend:taskNameMustBeFrom1To128", "任务名称须为 1 至 128 字节，步骤须为 1 至 16 项")
	}
	for _, step := range task.Steps {
		if err := validateCommandStep(step); err != nil {
			return err
		}
	}
	return nil
}

type CommandExportResult struct {
	Target       string                  `json:"target"`
	Address      string                  `json:"address"`
	Step         string                  `json:"step"`
	State        string                  `json:"state"`
	Result       *terminal.CommandResult `json:"result,omitempty"`
	Error        string                  `json:"error,omitempty"`
	ErrorMessage *appmessage.Descriptor  `json:"error_message,omitempty"`
	Check        *InspectionCheckResult  `json:"check,omitempty"`
	Baseline     string                  `json:"baseline,omitempty"`
}

func (a *AppService) ExportCommandResults(results []CommandExportResult) error {
	if len(results) == 0 || len(results) > 1024 {
		return appmessage.New("backend:exportFrom1To1024Results", "导出结果须为 1 至 1024 项")
	}
	report := struct {
		CreatedAt time.Time             `json:"created_at"`
		Results   []CommandExportResult `json:"results"`
	}{time.Now().UTC(), results}
	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	if len(data) > 16<<20 {
		return appmessage.New("backend:exportExceeds16MiBSelectFewerResults", "导出结果超过 16 MiB，请减少结果数量")
	}
	filename, err := application.Get().Dialog.SaveFile().SetMessage(nativeText("Export selected execution results (including command output)", "导出所选执行结果（包含命令输出）")).SetFilename("termquay-command-results.json").PromptForSingleSelection()
	if err != nil || filename == "" {
		return err
	}
	return os.WriteFile(filename, data, 0600)
}

func (a *AppService) DeleteCommandTask(id string) error {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	items, err := a.commandTasks()
	if err != nil {
		return err
	}
	index := -1
	for i := range items {
		if items[i].ID == id {
			index = i
			break
		}
	}
	if index < 0 {
		return appmessage.New("backend:commandTaskDoesNotExist", "命令任务不存在")
	}
	items = append(items[:index], items[index+1:]...)
	data, err := json.Marshal(items)
	if err != nil {
		return err
	}
	return a.store.SetSecretSetting("command_tasks", string(data))
}
