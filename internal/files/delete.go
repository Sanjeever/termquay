package files

import (
	"context"
	"errors"

	"io"
	"os"
	"path"
	"strings"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	"github.com/pkg/sftp/v2"
)

func Delete(ctx context.Context, client *sftp.Client, remote string, progress func(int)) error {
	if !path.IsAbs(remote) || path.Clean(remote) != remote || remote == "/" || len(remote) > 4096 {
		return appmessage.New("backend:deletionDestinationMustBeAnAbsoluteRemotePath", "删除目标必须是非根目录的远端绝对路径")
	}
	parent, err := client.RealPath(path.Dir(remote))
	if err != nil {
		return err
	}
	root := path.Join(parent, path.Base(remote))
	info, err := client.LStat(root)
	if err != nil {
		return err
	}
	type entry struct {
		name string
		mode os.FileMode
	}
	entries := []entry{}
	pathBytes := 0
	var scan func(string, os.FileInfo, int) error
	scan = func(name string, info os.FileInfo, depth int) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		pathBytes += len(name)
		if depth > 64 || len(entries) >= 10000 || pathBytes > 8<<20 {
			return appmessage.New("backend:deletionExceeds64Levels10000EntriesOr8", "删除目录超过 64 层、10000 项或 8 MiB 路径，请分批删除")
		}
		entries = append(entries, entry{name, info.Mode().Type()})
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return nil
		}
		directory, err := client.OpenDir(name)
		if err != nil {
			return err
		}
		defer directory.Close()
		for {
			children, readErr := directory.ReaddirContext(ctx, 128)
			for _, child := range children {
				if child.Name() == "." || child.Name() == ".." || strings.ContainsAny(child.Name(), "/\x00") {
					return appmessage.New("backend:serverReturnedAnInvalidDirectoryEntry", "服务端返回无效目录项")
				}
				childPath := path.Join(name, child.Name())
				current, err := client.LStat(childPath)
				if err != nil {
					return err
				}
				if err := scan(childPath, current, depth+1); err != nil {
					return err
				}
			}
			if readErr != nil {
				if errors.Is(readErr, io.EOF) {
					break
				}
				return readErr
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
			return appmessage.Errorf("backend:deletedItems", "已删除 %d 项：%w", deleted, err)
		}
		item := entries[i]
		for ancestor := path.Dir(item.name); ancestor != parent; ancestor = path.Dir(ancestor) {
			current, err := client.LStat(ancestor)
			if err != nil || !current.IsDir() || current.Mode()&os.ModeSymlink != 0 {
				return appmessage.Errorf("backend:deletedItemsParentDirectoryChanged", "已删除 %d 项，父目录发生变化：%s", deleted, ancestor)
			}
		}
		current, err := client.LStat(item.name)
		if err == nil && current.Mode().Type() != item.mode {
			err = appmessage.New("backend:pathTypeChangedAfterScanning", "路径类型自扫描后已变化")
		}
		if err == nil {
			err = client.Remove(item.name)
		}
		if err != nil {
			return appmessage.Errorf("backend:deletedItemsDeletingFailed", "已删除 %d 项，删除 %s 失败：%w", deleted, item.name, err)
		}
		deleted++
		if progress != nil {
			progress(deleted)
		}
	}
	return nil
}
