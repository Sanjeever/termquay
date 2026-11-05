package app

import (
	"errors"
	"fmt"
	"os"

	"golang.org/x/sys/windows"
)

func transferFileID(info os.FileInfo, filename string) (string, error) {
	file, err := os.Open(filename)
	if err != nil {
		return "", err
	}
	defer file.Close()
	current, err := file.Stat()
	if err != nil {
		return "", err
	}
	if !os.SameFile(info, current) {
		return "", errors.New("读取身份期间本地文件已变化")
	}
	var identity windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(windows.Handle(file.Fd()), &identity); err != nil {
		return "", err
	}
	return fmt.Sprintf("%d:%d:%d", identity.VolumeSerialNumber, identity.FileIndexHigh, identity.FileIndexLow), nil
}
