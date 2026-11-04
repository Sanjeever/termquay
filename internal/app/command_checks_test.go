package app

import (
	"testing"

	terminal "github.com/Sanjeever/termquay/internal/ssh"
)

func TestInspectionChecks(t *testing.T) {
	for _, test := range []struct {
		name    string
		check   CommandCheck
		command terminal.CommandResult
		state   string
	}{
		{"指定非零退出码", CommandCheck{Kind: "exit", Expected: "2"}, terminal.CommandResult{ExitCode: 2}, "pass"},
		{"截断不影响退出码", CommandCheck{Kind: "exit", Expected: "0"}, terminal.CommandResult{Truncated: true}, "pass"},
		{"文本匹配", CommandCheck{Kind: "text", Expected: "active"}, terminal.CommandResult{Stdout: "active\n"}, "pass"},
		{"文本不符", CommandCheck{Kind: "text", Expected: "active"}, terminal.CommandResult{Stdout: "stopped\n"}, "fail"},
		{"错误通道正则", CommandCheck{Kind: "regex", Source: "stderr", Expected: `^warn\d+$`}, terminal.CommandResult{Stderr: "warn42"}, "pass"},
		{"截断不能误判", CommandCheck{Kind: "text", Expected: "active"}, terminal.CommandResult{Stdout: "active", Truncated: true}, "unknown"},
		{"采集失败不能误判", CommandCheck{Kind: "text", Expected: "active"}, terminal.CommandResult{Stdout: "active", ExitCode: 1}, "unknown"},
		{"嵌套字段与数组", CommandCheck{Kind: "json", Pointer: "/a~1b/0/ok", Expected: "true"}, terminal.CommandResult{Stdout: `{"a/b":[{"ok":true}]}`}, "pass"},
		{"数字比较", CommandCheck{Kind: "json", Pointer: "/days", Operator: "gte", Expected: "30"}, terminal.CommandResult{Stdout: `{"days":42}`}, "pass"},
		{"数字等值表示", CommandCheck{Kind: "json", Expected: "1.00"}, terminal.CommandResult{Stdout: `1e0`}, "pass"},
		{"大整数精确比较", CommandCheck{Kind: "json", Expected: "9007199254740993"}, terminal.CommandResult{Stdout: `9007199254740992`}, "fail"},
		{"限制超大指数", CommandCheck{Kind: "json", Expected: "1"}, terminal.CommandResult{Stdout: `1e999999999`}, "unknown"},
		{"缺失字段不能当 null", CommandCheck{Kind: "json", Pointer: "/missing", Expected: "null"}, terminal.CommandResult{Stdout: `{}`}, "unknown"},
		{"多份 JSON 拒绝", CommandCheck{Kind: "json", Expected: "true"}, terminal.CommandResult{Stdout: `true false`}, "unknown"},
		{"网络失败不能当零", CommandCheck{Kind: "exit", Expected: "0"}, terminal.CommandResult{Error: "disconnected"}, "unknown"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := validateCommandStep(CommandStep{Name: "巡检", Script: "collect", TimeoutSeconds: 1, Check: &test.check}); err != nil {
				t.Fatal(err)
			}
			if got := evaluateCommandCheck(test.check, test.command); got.State != test.state {
				t.Fatalf("got %+v, want %s", got, test.state)
			}
		})
	}
}

func TestInspectionValidation(t *testing.T) {
	for _, check := range []CommandCheck{
		{Kind: "regex", Expected: "["},
		{Kind: "json", Pointer: "missing-slash", Expected: "true"},
		{Kind: "json", Pointer: "/bad~2escape", Expected: "true"},
		{Kind: "json", Expected: "1e999999999"},
		{Kind: "json", Expected: `"text"`, Operator: "gt"},
		{Kind: "file", FilePath: "relative-path"},
	} {
		script := "collect"
		if check.Kind == "file" {
			script = ""
		}
		if validateCommandStep(CommandStep{Name: "巡检", Script: script, TimeoutSeconds: 1, Check: &check}) == nil {
			t.Fatalf("接受无效判定 %+v", check)
		}
	}
	if err := validateCommandStep(CommandStep{Name: "基线", TimeoutSeconds: 1, Check: &CommandCheck{Kind: "file", FilePath: "/etc/example.conf"}}); err != nil {
		t.Fatal(err)
	}
}
