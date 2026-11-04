package app

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
)

type CommandStep struct {
	Name           string `json:"name"`
	Script         string `json:"script"`
	TimeoutSeconds int    `json:"timeout_seconds"`
}

type CommandTask struct {
	ID            string        `json:"id"`
	Name          string        `json:"name"`
	Steps         []CommandStep `json:"steps"`
	StopOnFailure bool          `json:"stop_on_failure"`
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
		return nil, errors.New("命令任务存储超过 1 MiB")
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
			return CommandTask{}, errors.New("命令任务达到 64 项上限")
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
			return CommandTask{}, errors.New("命令任务不存在")
		}
	}
	data, err := json.Marshal(items)
	if err != nil {
		return CommandTask{}, err
	}
	if len(data) > 1<<20 {
		return CommandTask{}, errors.New("命令任务总量超过 1 MiB")
	}
	if err = a.store.SetSecretSetting("command_tasks", string(data)); err != nil {
		return CommandTask{}, err
	}
	return task, nil
}

func validateCommandTask(task CommandTask) error {
	if task.Name == "" || len(task.Name) > 128 || len(task.Steps) == 0 || len(task.Steps) > 16 {
		return errors.New("任务名称须为 1 至 128 字节，步骤须为 1 至 16 项")
	}
	for _, step := range task.Steps {
		if strings.TrimSpace(step.Name) == "" || len(step.Name) > 128 || strings.TrimSpace(step.Script) == "" || len(step.Script) > 32<<10 || strings.ContainsRune(step.Script, 0) || step.TimeoutSeconds < 1 || step.TimeoutSeconds > 600 {
			return errors.New("步骤须包含名称、最多 32 KiB 的命令及 1 至 600 秒超时")
		}
	}
	return nil
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
		return errors.New("命令任务不存在")
	}
	items = append(items[:index], items[index+1:]...)
	data, err := json.Marshal(items)
	if err != nil {
		return err
	}
	return a.store.SetSecretSetting("command_tasks", string(data))
}
