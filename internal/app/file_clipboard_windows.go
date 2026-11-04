package app

import (
	"errors"
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/sys/windows"
)

func localClipboardFiles() ([]string, error) {
	var paths []string
	err := application.InvokeSyncWithError(func() error {
		user := windows.NewLazySystemDLL("user32.dll")
		shell := windows.NewLazySystemDLL("shell32.dll")
		opened, _, err := user.NewProc("OpenClipboard").Call(0)
		if opened == 0 {
			return err
		}
		defer user.NewProc("CloseClipboard").Call()
		const fileDrop = 15
		handle, _, _ := user.NewProc("GetClipboardData").Call(fileDrop)
		if handle == 0 {
			return errors.New("剪贴板没有本地文件，请先在资源管理器中复制文件")
		}
		query := shell.NewProc("DragQueryFileW")
		count, _, _ := query.Call(handle, 0xffffffff, 0, 0)
		if count == 0 || count > 64 {
			return errors.New("每次粘贴支持 1 至 64 个文件")
		}
		for i := uintptr(0); i < count; i++ {
			size, _, _ := query.Call(handle, i, 0, 0)
			if size == 0 || size > 4096 {
				return errors.New("剪贴板文件路径无效或超过长度限制")
			}
			buffer := make([]uint16, size+1)
			read, _, _ := query.Call(handle, i, uintptr(unsafe.Pointer(&buffer[0])), size+1)
			if read != size {
				return errors.New("无法读取完整剪贴板文件路径")
			}
			paths = append(paths, windows.UTF16ToString(buffer))
		}
		return nil
	})
	return paths, err
}
