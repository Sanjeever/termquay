package app

import (
	"strings"
	"testing"
)

func TestCommandTaskValidation(t *testing.T) {
	valid := func() CommandTask {
		return CommandTask{Name: "测试任务", Steps: []CommandStep{{Name: "步骤", Script: "echo test-only", TimeoutSeconds: 60}}}
	}
	for name, change := range map[string]func(*CommandTask){
		"空名称":    func(task *CommandTask) { task.Name = "" },
		"无步骤":    func(task *CommandTask) { task.Steps = nil },
		"步骤过多":   func(task *CommandTask) { task.Steps = make([]CommandStep, 17) },
		"空命令":    func(task *CommandTask) { task.Steps[0].Script = " \n" },
		"命令含空字符": func(task *CommandTask) { task.Steps[0].Script = "echo\x00test" },
		"命令过长":   func(task *CommandTask) { task.Steps[0].Script = strings.Repeat("x", (32<<10)+1) },
		"超时过小":   func(task *CommandTask) { task.Steps[0].TimeoutSeconds = 0 },
		"超时过大":   func(task *CommandTask) { task.Steps[0].TimeoutSeconds = 601 },
		"并发为负":   func(task *CommandTask) { task.Concurrency = -1 },
		"并发过大":   func(task *CommandTask) { task.Concurrency = 4 },
		"批次为负":   func(task *CommandTask) { task.BatchSize = -1 },
		"批次过大":   func(task *CommandTask) { task.BatchSize = 65 },
	} {
		t.Run(name, func(t *testing.T) {
			task := valid()
			change(&task)
			if err := validateCommandTask(task); err == nil {
				t.Fatal("接受了无效任务")
			}
		})
	}
	for _, task := range []CommandTask{valid(), {Name: "边界", Concurrency: 3, BatchSize: 64, Steps: []CommandStep{{Name: "步骤", Script: strings.Repeat("x", 32<<10), TimeoutSeconds: 600}}}} {
		if err := validateCommandTask(task); err != nil {
			t.Fatal(err)
		}
	}
}

func TestCommandTasksEncryptedUpdateAndDelete(t *testing.T) {
	a := testAppStore(t)
	task, err := a.SaveCommandTask(CommandTask{Name: " 测试任务 ", Steps: []CommandStep{{Name: "步骤", Script: "echo task-test-marker", TimeoutSeconds: 1}}})
	if err != nil || task.ID == "" || task.Name != "测试任务" {
		t.Fatal("创建任务失败", err)
	}
	raw, err := a.store.Setting("command_tasks")
	if err != nil || strings.Contains(raw, "task-test-marker") {
		t.Fatal("任务未加密存储", err)
	}
	task.Concurrency, task.BatchSize, task.FirstHostApproval = 2, 4, true
	if _, err := a.SaveCommandTask(task); err != nil {
		t.Fatal(err)
	}
	items, err := a.ListCommandTasks()
	if err != nil || len(items) != 1 || items[0].ID != task.ID || items[0].Concurrency != 2 || !items[0].FirstHostApproval {
		t.Fatal("更新任务未保留身份或策略", err)
	}
	task.ID = "missing"
	if _, err := a.SaveCommandTask(task); err == nil {
		t.Fatal("更新不存在的任务未报错")
	}
	if err := a.DeleteCommandTask(items[0].ID); err != nil {
		t.Fatal(err)
	}
	items, err = a.ListCommandTasks()
	if err != nil || len(items) != 0 {
		t.Fatal("任务未删除", err)
	}
	if err := a.DeleteCommandTask("missing"); err == nil {
		t.Fatal("删除不存在的任务未报错")
	}
}
