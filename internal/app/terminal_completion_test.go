package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestCompleteTerminalPath(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("本地路径补全当前限定 Unix")
	}
	directory := t.TempDir()
	for i := range 80 {
		if err := os.WriteFile(filepath.Join(directory, fmt.Sprintf("file-%02d", i)), nil, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(directory, "中文 空间"), 0700); err != nil {
		t.Fatal(err)
	}
	app := NewAppService(BuildInfo{}, nil)
	app.locals = map[string]*localTerminal{"terminal": {}}
	result, err := app.CompleteTerminalPath(context.Background(), "terminal", "terminal", directory, "file-", false)
	if err != nil || len(result.Entries) != 64 || !result.Truncated {
		t.Fatalf("bounded candidates: %+v %v", result, err)
	}
	result, err = app.CompleteTerminalPath(context.Background(), "terminal", "terminal", directory, "中文", true)
	if err != nil || len(result.Entries) != 1 || !result.Entries[0].Directory || result.Entries[0].Name != "中文 空间" {
		t.Fatalf("directory candidates: %+v %v", result, err)
	}
	if _, err = app.CompleteTerminalPath(context.Background(), "other", "terminal", directory, "", false); err == nil {
		t.Fatal("accepted unrelated workspace")
	}
	if err = os.Symlink("missing", filepath.Join(directory, "dangling")); err != nil {
		t.Fatal(err)
	}
	result, err = app.CompleteTerminalPath(context.Background(), "terminal", "terminal", directory, "dangling", false)
	if err != nil || len(result.Entries) != 1 || result.Entries[0].Directory {
		t.Fatalf("dangling link: %+v %v", result, err)
	}
	if _, err = app.CompleteTerminalPath(context.Background(), "terminal", "terminal", directory, "\a", false); err == nil {
		t.Fatal("accepted terminal control character in prefix")
	}
}

func TestTerminalCompletionPortableShortcuts(t *testing.T) {
	if err := validatePortableUI(map[string]string{"shortcuts": `{"completion":"Alt+Slash","terminalCompletion":"Alt+Slash"}`}); err != nil {
		t.Fatal(err)
	}
	if err := validatePortableUI(map[string]string{"shortcuts": `{"palette":"Alt+Slash","terminalCompletion":"Alt+Slash"}`}); err == nil {
		t.Fatal("accepted overlapping application shortcut")
	}
}
