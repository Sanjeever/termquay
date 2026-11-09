package app

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/Sanjeever/termquay/internal/ai"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
)

func TestAIWindowsPathAndFileParameters(t *testing.T) {
	for input, want := range map[string]string{`C:\Windows\System32`: "/C:/Windows/System32", `D:/测试 目录/file.txt`: "/D:/测试 目录/file.txt", `/C:/Windows`: "/C:/Windows"} {
		if got, err := aiRemotePath(input, "windows"); err != nil || got != want {
			t.Fatal(got, err)
		}
		b, _ := json.Marshal(map[string]any{"path": input})
		if _, err := validateAITool(ai.ToolCall{Name: "file_list", Arguments: string(b)}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := aiRemotePath(`C:\Windows`, "linux"); err == nil {
		t.Fatal("Linux 接受盘符路径")
	}
	for _, args := range []string{`{"path":"/","limit":0}`, `{"path":"/","offset":-1}`, `{"path":"/","limit":65}`} {
		if _, err := validateAITool(ai.ToolCall{Name: "file_list", Arguments: args}); err == nil {
			t.Fatal(args)
		}
	}
}

func TestAIFileDirectoryPaginationAndFiltering(t *testing.T) {
	a, _ := aiTestSSH(t)
	client, release, err := a.fileClient(t.Context(), "workspace")
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	if err := client.Mkdir("/C:"); err != nil {
		t.Fatal(err)
	}
	if err := client.Mkdir("/C:/目录"); err != nil {
		t.Fatal(err)
	}
	for i := range 550 {
		file, err := client.Create(fmt.Sprintf("/C:/目录/file-%03d.txt", i))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write([]byte("中文内容")); err != nil {
			t.Fatal(err)
		}
		file.Close()
	}
	run := &aiRun{owner: a.workspaces["workspace"], view: AIRunView{Workspace: "workspace"}, environment: terminal.RemoteEnvironment{OS: "windows"}}
	seen := map[string]bool{}
	offset := int64(0)
	for {
		page, err := a.listAIFileDirectory(t.Context(), run, aiToolArguments{Path: `C:\目录`, Offset: offset, Limit: 64})
		if err != nil {
			t.Fatal(err)
		}
		encoded, _ := json.Marshal(page)
		if len(encoded) > maxAIToolResultBytes || len(page.Entries) > 64 {
			t.Fatal("分页预算失效")
		}
		for _, entry := range page.Entries {
			if seen[entry.Name] {
				t.Fatal("重复条目")
			}
			seen[entry.Name] = true
		}
		if page.NextOffset == nil {
			break
		}
		if *page.NextOffset <= offset {
			t.Fatal("分页未前进")
		}
		offset = *page.NextOffset
	}
	if len(seen) != 550 {
		t.Fatal("大目录条目丢失", len(seen))
	}
	page, err := a.listAIFileDirectory(t.Context(), run, aiToolArguments{Path: "/C:/目录", Search: "FILE-549"})
	if err != nil || len(page.Entries) != 1 || page.NextOffset != nil {
		t.Fatal(page, err)
	}
	args := aiToolArguments{Path: `C:\目录\file-549.txt`, Encoding: "UTF-8", Limit: 5}
	first, err := a.readAIFileRange(t.Context(), run, args)
	if err != nil {
		t.Fatal(err)
	}
	if first.NextOffset == nil || !strings.HasPrefix("中文内容", first.Content) {
		t.Fatal(first)
	}
	args.Offset = *first.NextOffset
	args.Revision = first.Revision
	args.Limit = 4096
	second, err := a.readAIFileRange(t.Context(), run, args)
	if err != nil || first.Content+second.Content != "中文内容" {
		t.Fatal(second, err)
	}
}
