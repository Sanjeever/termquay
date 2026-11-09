package app

import (
	"bytes"
	"context"
	"encoding/json"
	"os/exec"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/Sanjeever/termquay/internal/ai"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
)

func TestWindowsAIQueriesThroughLocalSSHAndNativePowerShell(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("需要本机 Windows 服务、网络与事件日志")
	}
	a, _ := aiTestSSH(t, func(command, input string) (string, string, uint32) {
		ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
		defer cancel()
		process := exec.CommandContext(ctx, "cmd.exe", append([]string{"/d", "/c"}, strings.Fields(command)...)...)
		process.Stdin = strings.NewReader(input)
		var out, stderr bytes.Buffer
		process.Stdout = &out
		process.Stderr = &stderr
		err := process.Run()
		code := uint32(0)
		if err != nil {
			if exit, ok := err.(*exec.ExitError); ok {
				code = uint32(exit.ExitCode())
			} else {
				t.Error(err)
				code = 1
			}
		}
		return out.String(), stderr.String(), code
	})
	run := &aiRun{owner: a.workspaces["workspace"], view: AIRunView{Workspace: "workspace"}, ctx: t.Context(), budgetRemaining: maxAIRunDuration, rejected: map[string]bool{}, unknownScripts: map[string]bool{}}
	run.environment = a.aiEnvironment(t.Context(), run)
	if run.environment.OS != "windows" || run.environment.Shell != "powershell" || !strings.HasPrefix(run.environment.Version, "5.1") {
		t.Fatal(run.environment)
	}
	for _, name := range []string{"service_list", "service_inspect", "service_logs", "port_list"} {
		t.Run(name, func(t *testing.T) {
			args := aiToolArguments{Search: "EventLog", Unit: "EventLog"}
			result, state := a.invokeAITool(t.Context(), run, ai.ToolCall{Name: name}, args)
			if state != "complete" || result.Error != "" || !json.Valid([]byte(result.Data)) {
				t.Fatal(result, state)
			}
			var data map[string]any
			if err := json.Unmarshal([]byte(result.Data), &data); err != nil {
				t.Fatal(err)
			}
			if name == "service_inspect" && data["name"] != "EventLog" {
				t.Fatal(data)
			}
			if name == "service_list" && len(data["items"].([]any)) == 0 {
				t.Fatal("未找到本机 EventLog 服务")
			}
			if name == "service_logs" && data["source"] != "System/Service Control Manager" {
				t.Fatal(data)
			}
		})
	}
	result, state := a.invokeAITool(t.Context(), run, ai.ToolCall{Name: "exec"}, aiToolArguments{Script: "'中文 SSH 执行'", TimeoutSeconds: 10, OutputEncoding: "UTF-8"})
	if state != "complete" || strings.TrimSpace(result.Data) != "中文 SSH 执行" || result.Shell != "powershell" {
		t.Fatal(result, state)
	}
	result, state = a.invokeAITool(t.Context(), run, ai.ToolCall{Name: "container_list"}, aiToolArguments{})
	if state != "failed" || result.ErrorCode != "unsupported_transport" {
		t.Fatal(result, state)
	}
}

func TestWindowsServiceParametersRemainData(t *testing.T) {
	for _, name := range []string{"service_list", "service_inspect", "service_logs"} {
		value := `x'; throw 'injected`
		script, err := windowsAIQuery(name, aiToolArguments{Search: value, Unit: value}, terminal.RemoteEnvironment{})
		if err != nil || !strings.Contains(script, `'x''; throw ''injected'`) {
			t.Fatal(script, err)
		}
	}
}
