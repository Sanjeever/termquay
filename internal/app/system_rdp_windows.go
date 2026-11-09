package app

import (
	"encoding/binary"
	"encoding/hex"
	"errors"

	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"unicode/utf16"
	"unsafe"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	"github.com/Sanjeever/termquay/internal/store"
	"golang.org/x/sys/windows"
)

var systemRDPSlots = make(chan struct{}, 8)

func protectRDPPassword(password string) (string, error) {
	units, err := windows.UTF16FromString(password)
	if err != nil {
		return "", appmessage.New("backend:passwordContainsInvalidCharacters", "密码包含无效字符")
	}
	plain := make([]byte, (len(units)-1)*2)
	for i, unit := range units[:len(units)-1] {
		binary.LittleEndian.PutUint16(plain[i*2:], unit)
	}
	defer clear(plain)
	defer clear(units)
	input := windows.DataBlob{Size: uint32(len(plain)), Data: &plain[0]}
	var output windows.DataBlob
	if err := windows.CryptProtectData(&input, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &output); err != nil {
		return "", appmessage.Errorf("backend:couldNotEncryptSystemRDPCredentials", "加密系统 RDP 凭据失败: %w", err)
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(output.Data)))
	return hex.EncodeToString(unsafe.Slice(output.Data, output.Size)), nil
}

func launchSystemRDP(connection store.Connection, password, resolution string, clipboard bool, onError func(error)) error {
	select {
	case systemRDPSlots <- struct{}{}:
	default:
		return appmessage.New("backend:systemRDPLaunchTaskLimitReached8", "系统 RDP 启动任务达到上限（8 个）")
	}
	started := false
	defer func() {
		if !started {
			<-systemRDPSlots
		}
	}()
	client := filepath.Join(os.Getenv("SystemRoot"), "System32", "mstsc.exe")
	if _, err := os.Stat(client); err != nil {
		return appmessage.Errorf("backend:systemRDPClientUnavailable", "系统 RDP 客户端不可用: %w", err)
	}
	lines := []string{"full address:s:" + net.JoinHostPort(connection.Host, strconv.Itoa(connection.Port)), "username:s:" + connection.Username, "domain:s:" + connection.Domain, "authentication level:i:2", "enablecredsspsupport:i:1", "prompt for credentials:i:0", "redirectprinters:i:0", "redirectsmartcards:i:0", "redirectwebauthn:i:0", "drivestoredirect:s:", "redirectclipboard:i:" + strconv.Itoa(map[bool]int{false: 0, true: 1}[clipboard])}
	if password != "" {
		protected, err := protectRDPPassword(password)
		if err != nil {
			return err
		}
		lines = append(lines, "password 51:b:"+protected)
	}
	if resolution == "multimon" {
		lines = append(lines, "use multimon:i:1", "screen mode id:i:2")
	} else if resolution != "dynamic" {
		dimensions := strings.Split(resolution, "x")
		lines = append(lines, "desktopwidth:i:"+dimensions[0], "desktopheight:i:"+dimensions[1])
	} else {
		lines = append(lines, "dynamic resolution:i:1")
	}
	directory, err := os.MkdirTemp("", "termquay-rdp-")
	if err != nil {
		return err
	}
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		os.Remove(directory)
		return err
	}
	descriptor, err := windows.SecurityDescriptorFromString("D:P(A;OICI;FA;;;" + user.User.Sid.String() + ")(A;OICI;FA;;;SY)")
	if err != nil {
		os.Remove(directory)
		return err
	}
	dacl, _, err := descriptor.DACL()
	if err == nil {
		err = windows.SetNamedSecurityInfo(directory, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, dacl, nil)
	}
	if err != nil {
		os.Remove(directory)
		return appmessage.Errorf("backend:couldNotRestrictRDPTemporaryDirectoryAccess", "限制 RDP 临时目录访问失败: %w", err)
	}
	filename := filepath.Join(directory, "connection.rdp")
	cleanup := func() error { return errors.Join(os.Remove(filename), os.Remove(directory)) }
	units := utf16.Encode([]rune(strings.Join(lines, "\r\n") + "\r\n"))
	content := make([]byte, 2+len(units)*2)
	content[0], content[1] = 0xff, 0xfe
	for index, unit := range units {
		binary.LittleEndian.PutUint16(content[2+index*2:], unit)
	}
	if err = os.WriteFile(filename, content, 0600); err != nil {
		os.Remove(directory)
		return err
	}
	command := exec.Command(client, filename)
	if err = command.Start(); err != nil {
		return errors.Join(appmessage.Errorf("backend:couldNotStartSystemRDPClient", "启动系统 RDP 客户端失败: %w", err), cleanup())
	}
	started = true
	go func() {
		defer func() { <-systemRDPSlots }()
		err := command.Wait()
		if err != nil {
			err = appmessage.Errorf("backend:systemRDPClientExitedAbnormally", "系统 RDP 客户端退出异常: %w", err)
		}
		onError(errors.Join(err, cleanup()))
	}()
	return nil
}
