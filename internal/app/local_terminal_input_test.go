package app

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestLocalTerminalDropQuoting(t *testing.T) {
	for _, example := range []struct {
		kind  string
		paths []string
		want  string
	}{
		{"shell", []string{"/work/a'b", "/work/$(cmd) & file"}, "'/work/a'\\''b' '/work/$(cmd) & file' "},
		{"powershell", []string{`C:\work\a'b`}, `'C:\work\a''b' `},
		{"cmd", []string{`C:\work\a & b.txt`}, `"C:\work\a & b.txt" `},
	} {
		got, err := quoteLocalTerminalPaths(example.kind, example.paths)
		if err != nil || got != example.want {
			t.Fatalf("%s quoting = %q, %v", example.kind, got, err)
		}
	}
	for _, example := range []struct {
		kind  string
		paths []string
	}{
		{"shell", nil}, {"shell", make([]string, 65)}, {"shell", []string{"/work/line\nbreak"}},
		{"cmd", []string{`C:\%PATH%\file`}}, {"cmd", []string{`C:\!path!\file`}},
		{"wsl", []string{`C:\work\file`}}, {"shell", []string{strings.Repeat("a", 256<<10)}},
	} {
		if _, err := quoteLocalTerminalPaths(example.kind, example.paths); err == nil {
			t.Fatalf("accepted unsupported %s drop", example.kind)
		}
	}
}

func TestLocalTerminalDropUsesLiteralPOSIXArguments(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX shell quoting")
	}
	directory := t.TempDir()
	marker := filepath.Join(directory, "should-not-exist")
	paths := []string{filepath.Join(directory, "a'b file"), "$(touch " + marker + ")", "`touch " + marker + "`"}
	quoted, err := quoteLocalTerminalPaths("shell", paths)
	if err != nil {
		t.Fatal(err)
	}
	got, err := exec.Command("/bin/sh", "-c", "printf '%s\\0' "+quoted).Output()
	if err != nil {
		t.Fatal(err)
	}
	want := append([]byte(strings.Join(paths, "\x00")), 0)
	if !bytes.Equal(got, want) {
		t.Fatalf("shell changed quoted paths: %q", got)
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatal("drop executed command substitution")
	}
}

func TestLocalTerminalInputRejectsClosedAndLockedOwners(t *testing.T) {
	a := &AppService{}
	if _, err := a.LocalTerminalHasClipboardImage("missing"); err == nil {
		t.Fatal("read clipboard for missing PTY")
	}
	if _, err := a.prepareLocalTerminalDrop("missing", []string{"/tmp"}); err == nil {
		t.Fatal("accepted drop for missing PTY")
	}
	a.locals = map[string]*localTerminal{"local": {kind: "shell"}}
	a.appLocked.Store(true)
	if _, err := a.LocalTerminalHasClipboardImage("local"); err == nil {
		t.Fatal("read clipboard while locked")
	}
	if _, err := a.prepareLocalTerminalDrop("local", []string{"/tmp"}); err == nil {
		t.Fatal("accepted drop while locked")
	}
	a.appLocked.Store(false)
	directory := t.TempDir()
	if _, err := a.prepareLocalTerminalDrop("local", []string{directory}); err != nil {
		t.Fatal(err)
	}
	if _, err := a.prepareLocalTerminalDrop("local", []string{filepath.Join(directory, "missing")}); err == nil {
		t.Fatal("accepted missing path")
	}
}
