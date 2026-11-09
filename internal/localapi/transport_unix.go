//go:build !windows

package localapi

import (
	"context"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sync"
	"time"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	"golang.org/x/sys/unix"
)

func endpoint() (string, error) {
	dir := filepath.Join(os.TempDir(), fmt.Sprintf("termquay-%d", os.Getuid()))
	if err := os.Mkdir(dir, 0700); err != nil && !os.IsExist(err) {
		return "", err
	}
	info, err := os.Lstat(dir)
	if err != nil {
		return "", err
	}
	var stat unix.Stat_t
	if err = unix.Lstat(dir, &stat); err != nil {
		return "", err
	}
	if !info.IsDir() || info.Mode().Perm() != 0700 || stat.Uid != uint32(os.Getuid()) {
		return "", appmessage.Errorf("backend:invalidIPCDirectoryPermissionsOrOwner", "IPC 目录权限或所有者无效：%s", dir)
	}
	return filepath.Join(dir, "cli.sock"), nil
}

type unixListener struct {
	net.Listener
	lock *os.File
	once sync.Once
}

func (l *unixListener) Close() (err error) {
	l.once.Do(func() { err = l.Listener.Close(); l.lock.Close() })
	return
}

func listen() (net.Listener, error) {
	path, err := endpoint()
	if err != nil {
		return nil, err
	}
	fd, err := unix.Open(path+".lock", unix.O_CREAT|unix.O_RDWR|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0600)
	if err != nil {
		return nil, err
	}
	lock := os.NewFile(uintptr(fd), path+".lock")
	if err = unix.Flock(fd, unix.LOCK_EX|unix.LOCK_NB); err != nil {
		lock.Close()
		return nil, appmessage.Errorf("backend:anExistingDesktopInstanceOwnsTheCLIEndpoint", "已有桌面实例占用 CLI 端点：%w", err)
	}
	if err = os.Remove(path); err != nil && !os.IsNotExist(err) {
		lock.Close()
		return nil, err
	}
	l, err := net.Listen("unix", path)
	if err != nil {
		lock.Close()
		return nil, err
	}
	if err = os.Chmod(path, 0600); err != nil {
		l.Close()
		lock.Close()
		return nil, err
	}
	return &unixListener{Listener: l, lock: lock}, nil
}

func dial(ctx context.Context) (net.Conn, error) {
	path, err := endpoint()
	if err != nil {
		return nil, err
	}
	return (&net.Dialer{Timeout: 2 * time.Second}).DialContext(ctx, "unix", path)
}
