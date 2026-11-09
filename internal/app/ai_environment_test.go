package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/Sanjeever/termquay/internal/ai"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
)

func TestAIEnvironmentToolBoundaries(t *testing.T) {
	unknown := terminal.RemoteEnvironment{OS: "unknown"}
	if tools := aiToolsForEnvironment(unknown); len(tools) != 2 {
		t.Fatal(tools)
	}
	windows := terminal.RemoteEnvironment{OS: "windows", Shell: "powershell", Services: true, Events: true, TCP: true, UDP: true}
	for _, tool := range aiToolsForEnvironment(windows) {
		if strings.HasPrefix(tool.Name, "container_") || strings.Contains(tool.Description, "systemd") || strings.Contains(tool.Description, "sh -s") {
			t.Fatal(tool)
		}
	}
	err := aiToolUnavailable(windows, "container_list")
	var typed *aiToolError
	if !errors.As(err, &typed) || typed.Code != "unsupported_transport" {
		t.Fatal(err)
	}
	result, state := boundedAIToolResult(nil, err)
	if result.Status != "error" || state != "failed" || result.ErrorCode != "unsupported_transport" || result.Data != "null" {
		t.Fatal(result, state)
	}
	result, state = boundedAIToolResult(LinuxServiceList{Items: []LinuxService{}, Warning: "query failed"}, errors.New("permission denied"))
	if result.Status != "error" || state != "failed" || result.Error == "" {
		t.Fatal(result, state)
	}
}

func TestAIUnavailableToolDoesNotOpenSSHChannel(t *testing.T) {
	a, executed := aiTestSSH(t)
	run := &aiRun{owner: a.workspaces["workspace"], view: AIRunView{Workspace: "workspace"}, environment: terminal.RemoteEnvironment{OS: "windows"}}
	result, state := a.invokeAITool(context.Background(), run, ai.ToolCall{Name: "exec"}, aiToolArguments{Script: "Get-Service", TimeoutSeconds: 10})
	if state != "failed" || result.ErrorCode != "capability_unavailable" || len(executed) != 0 {
		t.Fatal(result, state)
	}
}

func TestAIStructuredOutputIsNeverCutInsideJSON(t *testing.T) {
	result, state := boundedAIToolResult(map[string]any{"items": []string{strings.Repeat("中", maxAIToolResultBytes)}}, nil)
	if !json.Valid([]byte(result.Data)) || !result.Truncated || state != "failed" || result.ErrorCode != "result_too_large" {
		t.Fatal(result, state)
	}
	result, state = boundedAIToolResult(map[string]any{"items": []string{}, "truncated": true}, nil)
	if state != "complete" || result.Status != "partial" || !json.Valid([]byte(result.Data)) {
		t.Fatal(result, state)
	}
}

func TestAIRawOutputRemainsBounded(t *testing.T) {
	result, _ := boundedAIToolResult(terminal.CommandResult{ExitCode: 1, Error: "encoding", StdoutBase64: strings.Repeat("AAAA", 20000), StderrBase64: strings.Repeat("BBBB", 10000)}, nil)
	if len(result.StdoutBase64)+len(result.StderrBase64)+len(result.Data)+len(result.Stderr) > maxAIToolResultBytes || len(result.StdoutBase64)%4 != 0 || len(result.StderrBase64)%4 != 0 || !result.Truncated {
		t.Fatal("原始输出预算失效")
	}
}
