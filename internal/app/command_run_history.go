package app

import (
	"encoding/json"
	"errors"
	"github.com/wailsapp/wails/v3/pkg/application"
)

const maxSavedCommandRuns = 16
const maxSavedCommandRunBytes = 8 << 20

func (a *AppService) commandRunHistory() ([]CommandRunSummary, error) {
	if err := a.openStorage(); err != nil {
		return nil, err
	}
	value, err := a.store.SecretSetting("command_run_history")
	if err != nil {
		return nil, err
	}
	items := []CommandRunSummary{}
	if len(value) > 64<<10 {
		return nil, errors.New("执行记录索引超过大小限制")
	}
	if value != "" {
		if err := json.Unmarshal([]byte(value), &items); err != nil {
			return nil, err
		}
	}
	if len(items) > maxSavedCommandRuns {
		return nil, errors.New("执行记录索引超过数量限制")
	}
	return items, nil
}

func (a *AppService) ListCommandRuns() ([]CommandRunSummary, error) {
	a.storeMu.Lock()
	items, err := a.commandRunHistory()
	a.storeMu.Unlock()
	if err != nil {
		return nil, err
	}
	index := make(map[string]int, len(items))
	for i, item := range items {
		index[item.ID] = i
	}
	a.mu.Lock()
	for _, run := range a.commandRuns {
		if i, exists := index[run.view.Summary.ID]; exists {
			item := run.view.Summary
			item.Saved = true
			items[i] = item
		} else {
			items = append(items, run.view.Summary)
		}
	}
	a.mu.Unlock()
	sortCommandRuns(items)
	return items, nil
}

func (a *AppService) GetCommandRun(id string) (CommandRunRecord, error) {
	a.mu.Lock()
	if run := a.commandRuns[id]; run != nil {
		view := run.view
		view.Results = append([]CommandRunItem(nil), view.Results...)
		a.mu.Unlock()
		return view, nil
	}
	a.mu.Unlock()
	if !validWorkspaceID(id) {
		return CommandRunRecord{}, errors.New("执行记录标识无效")
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return CommandRunRecord{}, err
	}
	value, err := a.store.SecretSetting("command_run:" + id)
	if err != nil {
		return CommandRunRecord{}, err
	}
	if value == "" || len(value) > maxSavedCommandRunBytes {
		return CommandRunRecord{}, errors.New("执行记录不存在或超过大小限制")
	}
	var record CommandRunRecord
	if err := json.Unmarshal([]byte(value), &record); err != nil {
		return record, err
	}
	if record.Summary.ID != id || record.Summary.FinishedAt == 0 || len(record.Results) > 1024 {
		return CommandRunRecord{}, errors.New("执行记录内容无效")
	}
	return record, nil
}

func (a *AppService) SaveCommandRun(id string) (CommandRunSummary, error) {
	a.mu.Lock()
	run := a.commandRuns[id]
	if run == nil || run.view.Summary.FinishedAt == 0 {
		a.mu.Unlock()
		return CommandRunSummary{}, errors.New("请选择本次运行中已结束的任务")
	}
	view := run.view
	view.Summary.Saved = true
	view.Results = append([]CommandRunItem(nil), view.Results...)
	a.mu.Unlock()
	data, err := json.Marshal(view)
	if err != nil {
		return CommandRunSummary{}, err
	}
	if len(data) > maxSavedCommandRunBytes {
		return CommandRunSummary{}, errors.New("执行记录超过 8 MiB，无法保存；可选择部分结果导出")
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	items, err := a.commandRunHistory()
	if err != nil {
		return CommandRunSummary{}, err
	}
	found := false
	for i, item := range items {
		if item.ID == id {
			items[i] = view.Summary
			found = true
		}
	}
	if !found {
		if len(items) >= maxSavedCommandRuns {
			return CommandRunSummary{}, errors.New("加密执行记录达到 16 项上限，请先移除旧记录")
		}
		items = append(items, view.Summary)
	}
	index, err := json.Marshal(items)
	if err != nil {
		return CommandRunSummary{}, err
	}
	if err := a.store.UpdateSecretSettings(map[string]string{"command_run_history": string(index), "command_run:" + id: string(data)}, nil); err != nil {
		return CommandRunSummary{}, err
	}
	a.mu.Lock()
	if current := a.commandRuns[id]; current == run {
		run.view.Summary.Saved = true
		a.commandRunChangedLocked(run)
	}
	a.mu.Unlock()
	return view.Summary, nil
}

func (a *AppService) DeleteCommandRun(id string) error {
	if !validWorkspaceID(id) {
		return errors.New("执行记录标识无效")
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	items, err := a.commandRunHistory()
	if err != nil {
		return err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if run := a.commandRuns[id]; run != nil && run.view.Summary.FinishedAt == 0 {
		return errors.New("运行中的任务须先取消，结束后再移除")
	}
	remaining := make([]CommandRunSummary, 0, len(items))
	for _, item := range items {
		if item.ID != id {
			remaining = append(remaining, item)
		}
	}
	index, err := json.Marshal(remaining)
	if err != nil {
		return err
	}
	if err := a.store.UpdateSecretSettings(map[string]string{"command_run_history": string(index)}, []string{"command_run:" + id}); err != nil {
		return err
	}
	delete(a.commandRuns, id)
	application.Get().Event.Emit("command-run:removed", id)
	return nil
}
