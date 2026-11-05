package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/Sanjeever/termquay/internal/localapi"
)

func TestHelpAndVersionWithoutDesktop(t *testing.T) {
	for _, args := range [][]string{{"--help"}, {"help", "exec"}, {"connection", "list", "--help"}, {"workspace", "--help"}, {"--version"}} {
		var out, stderr bytes.Buffer
		if code := Run(context.Background(), args, "1.3.0", nil, &out, &stderr); code != 0 || out.Len() == 0 || stderr.Len() != 0 {
			t.Fatalf("%v: %d %s", args, code, stderr.String())
		}
	}
}

func TestInvalidExecutionJSON(t *testing.T) {
	for _, args := range [][]string{
		{"exec", "--json"},
		{"exec", "--workspace", "id", "--command", "", "--json"},
		{"exec", "--workspace", "id", "--command", "true", "--script-file", "-", "--json"},
		{"exec", "--workspace", "id", "--script-file", "-", "--json"},
		{"exec", "--workspace", "id", "--command", "true", "--timeout", "601s", "--json"},
	} {
		var out, stderr bytes.Buffer
		if code := Run(context.Background(), args, "1.3.0", strings.NewReader(strings.Repeat("x", localapi.MaxScript+1)), &out, &stderr); code != 2 {
			t.Fatalf("%v: %d", args, code)
		}
		var response localapi.Response
		if err := json.Unmarshal(out.Bytes(), &response); err != nil || response.Error == nil || response.Error.Code != "usage" || stderr.Len() != 0 {
			t.Fatalf("JSON 契约无效：%s %s", out.String(), stderr.String())
		}
	}
}

func TestRemoteFailureAndStreams(t *testing.T) {
	response := localapi.Result(map[string]any{"workspace": "id", "result": map[string]any{"stdout": "out", "stderr": "err", "exit_code": 7, "truncated": false}})
	response.Error = &localapi.Error{Code: "remote_exit", Message: "远端失败"}
	var out, stderr bytes.Buffer
	if code := output(response, false, &out, &stderr, 1); code != 1 || out.String() != "out" || !strings.Contains(stderr.String(), "err") {
		t.Fatal("标准流或失败退出码错误")
	}
}
