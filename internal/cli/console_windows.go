package cli

import (
	"os"

	"golang.org/x/sys/windows"
)

func PrepareConsole() {
	streams := []struct {
		kind uint32
		file **os.File
		name string
	}{{windows.STD_INPUT_HANDLE, &os.Stdin, "stdin"}, {windows.STD_OUTPUT_HANDLE, &os.Stdout, "stdout"}, {windows.STD_ERROR_HANDLE, &os.Stderr, "stderr"}}
	prior := make([]windows.Handle, 3)
	for i, s := range streams {
		h, _ := windows.GetStdHandle(s.kind)
		if _, err := windows.GetFileType(h); err == nil {
			prior[i] = h
		}
	}
	attach := windows.NewLazySystemDLL("kernel32.dll").NewProc("AttachConsole")
	attach.Call(uintptr(^uint32(0)))
	for i, s := range streams {
		h := prior[i]
		if h == 0 {
			h, _ = windows.GetStdHandle(s.kind)
		} else {
			windows.SetStdHandle(s.kind, h)
		}
		if h != 0 && h != windows.InvalidHandle {
			*s.file = os.NewFile(uintptr(h), s.name)
		}
	}
}
