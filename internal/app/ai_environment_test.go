package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
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

func TestAIWindowsApprovalUsesDetectedInterpreter(t *testing.T) {
	var executed atomic.Int32
	a, _ := aiTestSSH(t, func(command, input string) (string, string, uint32) {
		if command == "uname -s" {
			return "", "not supported", 1
		}
		if strings.Contains(input, "@{os='windows'") {
			return `{"os":"windows","shell":"powershell","version":"5.1","services":true,"events":true,"tcp":true,"udp":true}`, "", 0
		}
		if !strings.HasPrefix(command, "powershell.exe ") {
			t.Error("Windows 执行仍经过 sh")
		}
		executed.Add(1)
		return "windows-output", "", 0
	})
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if requests.Add(1) == 1 {
			aiTestCall(w, "windows-call", "'windows'")
		} else {
			aiTestReply(w)
		}
	}))
	defer server.Close()
	aiTestConfigure(t, a, server.URL, true)
	aiTestStart(t, a)
	pending := waitAI(t, a, func(v AIRunView) bool { return v.Pending != nil })
	if pending.Pending.Shell != "powershell" || executed.Load() != 0 {
		t.Fatal(pending, executed.Load())
	}
	if err := a.ApproveAIToolCall(decisionFor(pending)); err != nil {
		t.Fatal(err)
	}
	waitAI(t, a, func(v AIRunView) bool { return v.State == "complete" })
	if executed.Load() != 1 {
		t.Fatal("批准未绑定一次实际执行", executed.Load())
	}
}

func TestAIEncodingFailureIsNotReplayed(t *testing.T) {
	var executed atomic.Int32
	a, _ := aiTestSSH(t, func(string, string) (string, string, uint32) { executed.Add(1); return string([]byte{0xff}), "", 0 })
	run := &aiRun{owner: a.workspaces["workspace"], view: AIRunView{Workspace: "workspace"}, ctx: t.Context(), environment: terminal.RemoteEnvironment{OS: "linux", Shell: "sh"}, unknownScripts: map[string]bool{}, rejected: map[string]bool{}}
	args := aiToolArguments{Script: "native_command", TimeoutSeconds: 10, OutputEncoding: "UTF-8"}
	result, state := a.invokeAITool(t.Context(), run, ai.ToolCall{Name: "exec"}, args)
	if state != "failed" || result.ErrorCode != "output_encoding" || result.StdoutBase64 == "" || result.StatusUnknown {
		t.Fatal(result, state)
	}
	args.OutputEncoding = "GBK"
	result, state = a.invokeAITool(t.Context(), run, ai.ToolCall{Name: "exec"}, args)
	if state != "not_executed" || result.ErrorCode != "replay_blocked" || executed.Load() != 1 {
		t.Fatal(result, state, executed.Load())
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
