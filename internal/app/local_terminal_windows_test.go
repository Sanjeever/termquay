//go:build windows

package app

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"
	"unsafe"

	pty "github.com/aymanbagabas/go-pty"
	"golang.org/x/sys/windows"
)

type consoleKeyRecord struct {
	Down   int32
	Repeat uint16
	Key    uint16
	Scan   uint16
	Char   uint16
	State  uint32
}

func TestLocalTerminalConsoleInputHelper(t *testing.T) {
	directory := os.Getenv("TERMQUAY_CONSOLE_INPUT_HELPER")
	if directory == "" {
		t.Skip("ConPTY subprocess helper")
	}
	handle, err := windows.GetStdHandle(windows.STD_INPUT_HANDLE)
	if err != nil {
		t.Fatal(err)
	}
	var mode uint32
	if err := windows.GetConsoleMode(handle, &mode); err != nil {
		t.Fatal(err)
	}
	mode &^= windows.ENABLE_ECHO_INPUT | windows.ENABLE_LINE_INPUT | windows.ENABLE_PROCESSED_INPUT | windows.ENABLE_VIRTUAL_TERMINAL_INPUT
	if err := windows.SetConsoleMode(handle, mode); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "ready"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	readInput := windows.NewLazySystemDLL("kernel32.dll").NewProc("ReadConsoleInputW")
	for {
		var record struct {
			Type    uint16
			Padding uint16
			Key     consoleKeyRecord
		}
		var count uint32
		ok, _, err := readInput.Call(uintptr(handle), uintptr(unsafe.Pointer(&record)), 1, uintptr(unsafe.Pointer(&count)))
		if ok == 0 {
			t.Fatal(err)
		}
		if record.Type != 1 || record.Key.Down == 0 || record.Key.Char == 0 {
			continue
		}
		data, err := json.Marshal(record.Key)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(directory, "key.json"), data, 0600); err != nil {
			t.Fatal(err)
		}
		return
	}
}

func TestLocalTerminalWin32KeyRecords(t *testing.T) {
	for _, test := range []struct {
		name  string
		input string
		key   uint16
		char  uint16
		state uint32
	}{
		{"legacy LF becomes Ctrl+Enter", "\n", 13, 10, 8},
		{"Ctrl+J", "\x1b[74;36;10;1;8;1_\x1b[74;36;10;0;8;1_", 74, 10, 8},
		{"Shift+Enter", "\x1b[13;28;13;1;16;1_\x1b[13;28;13;0;16;1_", 13, 13, 16},
		{"Alt+Enter", "\x1b[13;28;13;1;2;1_\x1b[13;28;13;0;2;1_", 13, 13, 2},
	} {
		t.Run(test.name, func(t *testing.T) {
			directory := t.TempDir()
			executable, err := os.Executable()
			if err != nil {
				t.Fatal(err)
			}
			console, err := pty.New()
			if err != nil {
				t.Fatal(err)
			}
			command := console.Command(executable, "-test.run=^TestLocalTerminalConsoleInputHelper$")
			command.Env = append(os.Environ(), "TERMQUAY_CONSOLE_INPUT_HELPER="+directory)
			if err := command.Start(); err != nil {
				console.Close()
				t.Fatal(err)
			}
			readDone := make(chan struct{})
			go func() {
				io.Copy(io.Discard, console)
				close(readDone)
			}()
			done := make(chan error, 1)
			go func() { done <- command.Wait() }()
			defer func() {
				command.Process.Kill()
				// Older Windows versions need the output reader alive during ClosePseudoConsole.
				console.Close()
				<-readDone
			}()
			deadline := time.NewTimer(5 * time.Second)
			defer deadline.Stop()
			tick := time.NewTicker(10 * time.Millisecond)
			defer tick.Stop()
		ready:
			for {
				select {
				case <-tick.C:
					if _, err := os.Stat(filepath.Join(directory, "ready")); err == nil {
						break ready
					}
				case err := <-done:
					t.Fatalf("console helper exited before readiness: %v", err)
				case <-deadline.C:
					t.Fatal("console helper did not become ready")
				}
			}
			if _, err := console.Write([]byte(test.input)); err != nil {
				t.Fatal(err)
			}
			select {
			case err := <-done:
				if err != nil {
					t.Fatal(err)
				}
			case <-deadline.C:
				t.Fatal("console helper did not receive the key")
			}
			data, err := os.ReadFile(filepath.Join(directory, "key.json"))
			if err != nil {
				t.Fatal(err)
			}
			var key consoleKeyRecord
			if err := json.Unmarshal(data, &key); err != nil {
				t.Fatal(err)
			}
			if key.Key != test.key || key.Char != test.char || key.State != test.state {
				t.Fatalf("unexpected console key: %+v", key)
			}
		})
	}
}
