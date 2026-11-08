package files

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path"
	"strings"

	"github.com/pkg/sftp"
)

func Delete(ctx context.Context, client *sftp.Client, remote string, progress func(int)) error {
	if !path.IsAbs(remote) || path.Clean(remote) != remote || remote == "/" || len(remote) > 4096 {
		return errors.New("删除目标必须是非根目录的远端绝对路径")
	}
	parent, err := client.RealPath(path.Dir(remote))
	if err != nil {
		return err
	}
	root := path.Join(parent, path.Base(remote))
	info, err := client.Lstat(root)
	if err != nil {
		return err
	}
	type entry struct {
		name string
		mode os.FileMode
	}
	entries := []entry{}
	var scan func(string, os.FileInfo, int) error
	scan = func(name string, info os.FileInfo, depth int) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if depth > 64 || len(entries) >= 10000 {
			return errors.New("删除目录超过 64 层或 10000 项，请分批删除")
		}
		entries = append(entries, entry{name, info.Mode().Type()})
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return nil
		}
		children, err := client.ReadDirContext(ctx, name)
		if err != nil {
			return err
		}
		if len(children)+len(entries) > 10000 {
			return errors.New("删除目录超过 10000 项，请分批删除")
		}
		for _, child := range children {
			if child.Name() == "." || child.Name() == ".." || strings.ContainsAny(child.Name(), "/\x00") {
				return errors.New("服务端返回无效目录项")
			}
			childPath := path.Join(name, child.Name())
			current, err := client.Lstat(childPath)
			if err != nil {
				return err
			}
			if err := scan(childPath, current, depth+1); err != nil {
				return err
			}
		}
		return nil
	}
	if err := scan(root, info, 0); err != nil {
		return err
	}
	deleted := 0
	for i := len(entries) - 1; i >= 0; i-- {
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("已删除 %d 项：%w", deleted, err)
		}
		item := entries[i]
		for ancestor := path.Dir(item.name); ancestor != parent; ancestor = path.Dir(ancestor) {
			current, err := client.Lstat(ancestor)
			if err != nil || !current.IsDir() || current.Mode()&os.ModeSymlink != 0 {
				return fmt.Errorf("已删除 %d 项，父目录发生变化：%s", deleted, ancestor)
			}
		}
		current, err := client.Lstat(item.name)
		if err == nil && current.Mode().Type() != item.mode {
			err = errors.New("路径类型自扫描后已变化")
		}
		if err == nil {
			if item.mode.IsDir() {
				err = client.RemoveDirectory(item.name)
			} else {
				err = client.Remove(item.name)
			}
		}
		if err != nil {
			return fmt.Errorf("已删除 %d 项，删除 %s 失败：%w", deleted, item.name, err)
		}
		deleted++
		if progress != nil {
			progress(deleted)
		}
	}
	return nil
}
