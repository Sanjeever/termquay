package app

import (
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestLocalTerminalDirectoryValidation(t *testing.T) {
	directory := t.TempDir()
	file := filepath.Join(directory, "file")
	if err := os.WriteFile(file, nil, 0600); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{"relative", directory + "\n", file, filepath.Join(directory, "missing")} {
		if _, err := localTerminalDirectory(invalid); err == nil {
			t.Fatalf("accepted invalid directory %q", invalid)
		}
	}
	if got, err := localTerminalDirectory(directory); err != nil || got != filepath.Clean(directory) {
		t.Fatalf("directory = %q, %v", got, err)
	}
}

func TestLocalTerminalRecentDirectories(t *testing.T) {
	a := testAppStore(t)
	for index := range maxLocalTerminalDirectories + 2 {
		if err := a.rememberLocalTerminalDirectory(strconv.Itoa(index)); err != nil {
			t.Fatal(err)
		}
	}
	if err := a.rememberLocalTerminalDirectory("5"); err != nil {
		t.Fatal(err)
	}
	got, err := a.GetLocalTerminalDirectories()
	if err != nil || len(got) != maxLocalTerminalDirectories || got[0] != "5" || got[1] != "11" {
		t.Fatalf("recent directories = %v, %v", got, err)
	}
}

func TestLocalTerminalStartsInSelectedDirectory(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX login shell fixture")
	}
	t.Setenv("SHELL", "/bin/sh")
	a := testAppStore(t)
	directory := t.TempDir()
	opened, err := a.OpenLocalTerminal("shell", directory, 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	defer a.CloseLocalTerminal(opened.ID)
	if opened.Directory != directory || opened.Hostname == "" {
		t.Fatalf("terminal metadata = %+v", opened)
	}
	session := a.locals[opened.ID]
	go io.Copy(io.Discard, session.pty)
	current, err := a.GetLocalTerminalDirectory(opened.ID)
	if err != nil || current == "" {
		t.Fatalf("current directory = %q, %v", current, err)
	}
	if _, err := session.pty.Write([]byte("pwd > termquay-cwd; exit\r")); err != nil {
		t.Fatal(err)
	}
	select {
	case <-session.done:
	case <-time.After(5 * time.Second):
		t.Fatal("shell did not exit")
	}
	if _, err := os.Stat(filepath.Join(directory, "termquay-cwd")); err != nil {
		t.Fatalf("shell did not use selected working directory: %v", err)
	}
	if _, err := a.OpenLocalTerminal("shell", filepath.Join(directory, "missing"), 80, 24); err == nil {
		t.Fatal("missing directory silently fell back")
	}
}

func TestLocalTerminalDirectoryAfterChange(t *testing.T) {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		t.Skip("native process cwd lookup is supported on macOS and Linux")
	}
	t.Setenv("SHELL", "/bin/sh")
	a := testAppStore(t)
	directory := t.TempDir()
	child := filepath.Join(directory, "project")
	if err := os.Mkdir(child, 0700); err != nil {
		t.Fatal(err)
	}
	opened, err := a.OpenLocalTerminal("shell", directory, 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	defer a.CloseLocalTerminal(opened.ID)
	session := a.locals[opened.ID]
	go io.Copy(io.Discard, session.pty)
	if _, err := session.pty.Write([]byte("cd project\r")); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		current, err := a.GetLocalTerminalDirectory(opened.ID)
		if err != nil {
			t.Fatal(err)
		}
		if strings.HasSuffix(current, "/project") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("shell directory did not change: %q", current)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
