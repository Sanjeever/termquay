package app

import (
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLocalTerminalFileURL(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "中文 space#?% file.go")
	if err := os.WriteFile(path, []byte("package example\n"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, editor := range []string{"vscode", "vscode-insiders"} {
		for _, name := range []string{path, filepath.Base(path)} {
			got, err := localTerminalFileURL(name, directory, 42, 8, editor)
			if err != nil {
				t.Fatal(err)
			}
			uri, err := url.Parse(got)
			wantPath := "/" + strings.TrimPrefix(filepath.ToSlash(path), "/") + ":42:8"
			if err != nil || uri.Scheme != editor || uri.Host != "file" || uri.Path != wantPath || uri.RawQuery != "" || uri.Fragment != "" {
				t.Fatalf("editor URI = %q, %v", got, err)
			}
		}
	}
	for _, example := range []struct {
		path, directory, editor string
		line, column            int
	}{
		{path, directory, "https", 1, 1},
		{path, directory, "vscode", 0, 1},
		{path, directory, "vscode", 1, -1},
		{"file.go", "", "vscode", 1, 1},
		{path + "\n", directory, "vscode", 1, 1},
		{directory, directory, "vscode", 1, 1},
		{filepath.Join(directory, "missing"), directory, "vscode", 1, 1},
	} {
		if _, err := localTerminalFileURL(example.path, example.directory, example.line, example.column, example.editor); err == nil {
			t.Fatalf("accepted invalid file link: %+v", example)
		}
	}
}

func TestLocalTerminalFileOwner(t *testing.T) {
	a := &AppService{locals: map[string]*localTerminal{"local": {kind: "shell"}, "wsl": {kind: "wsl"}}}
	directory := t.TempDir()
	path := filepath.Join(directory, "file.go")
	if err := os.WriteFile(path, nil, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := a.prepareLocalTerminalFile("local", path, "", 1, 1, "vscode"); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"missing", "wsl"} {
		if _, err := a.prepareLocalTerminalFile(id, path, "", 1, 1, "vscode"); err == nil {
			t.Fatalf("accepted %s owner", id)
		}
	}
	a.appLocked.Store(true)
	if _, err := a.prepareLocalTerminalFile("local", path, "", 1, 1, "vscode"); err == nil {
		t.Fatal("opened file while locked")
	}
}
