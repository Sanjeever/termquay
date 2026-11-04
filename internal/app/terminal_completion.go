package app

import (
	"context"
	"errors"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

type CompletionPath struct {
	Name      string `json:"name"`
	Directory bool   `json:"directory"`
}
type CompletionPaths struct {
	Entries   []CompletionPath `json:"entries"`
	Truncated bool             `json:"truncated"`
}

func invalidCompletionText(value string) bool {
	return strings.ContainsFunc(value, func(char rune) bool { return char < 0x20 || char == 0x7f })
}

func (a *AppService) CompleteTerminalPath(ctx context.Context, workspace, terminal, directory, prefix string, directoriesOnly bool) (CompletionPaths, error) {
	result := CompletionPaths{Entries: []CompletionPath{}}
	if !strings.HasPrefix(directory, "/") || len(directory) > 4096 || len(prefix) > 1024 || strings.Contains(prefix, "/") || invalidCompletionText(directory+prefix) {
		return result, errors.New("补全路径无效")
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	select {
	case a.fileSlots <- struct{}{}:
		defer func() { <-a.fileSlots }()
	default:
		return result, errors.New("文件通道繁忙，请稍后重试补全")
	}
	a.mu.Lock()
	local := a.locals[terminal]
	owner := a.workspaces[workspace]
	pending := a.terminals[terminal]
	validRemote := owner != nil && pending != nil && pending.workspace == workspace
	a.mu.Unlock()
	var read func() ([]fs.FileInfo, error)
	var stat func(string) (fs.FileInfo, error)
	if local != nil && workspace == terminal {
		if runtime.GOOS == "windows" {
			return result, errors.New("本地路径补全当前支持 Unix 终端")
		}
		file, err := os.Open(directory)
		if err != nil {
			return result, err
		}
		defer file.Close()
		read = func() ([]fs.FileInfo, error) { return file.Readdir(64) }
		stat = func(name string) (fs.FileInfo, error) { return os.Stat(filepath.Join(directory, name)) }
	} else if validRemote {
		stopOwner := context.AfterFunc(owner.ctx, cancel)
		defer stopOwner()
		client, err := owner.terminal.DirectoryClient(ctx)
		if err != nil {
			return result, err
		}
		defer client.Close()
		stopClient := context.AfterFunc(ctx, func() { client.Close() })
		defer stopClient()
		file, err := client.OpenDir(directory)
		if err != nil {
			return result, err
		}
		defer file.Close()
		read = func() ([]fs.FileInfo, error) { return file.ReaddirContext(ctx, 64) }
		stat = func(name string) (fs.FileInfo, error) { return client.Stat(path.Join(directory, name)) }
	} else {
		return result, errors.New("补全所属终端已关闭")
	}
	for scanned := 0; scanned < 8192; {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		entries, err := read()
		for _, entry := range entries {
			scanned++
			name := entry.Name()
			if name == "." || name == ".." || name != path.Base(name) || len(name) > 1024 || !utf8.ValidString(name) || invalidCompletionText(name) || !strings.HasPrefix(name, prefix) || strings.HasPrefix(name, ".") && !strings.HasPrefix(prefix, ".") {
				continue
			}
			isDirectory := entry.IsDir()
			if entry.Mode()&fs.ModeSymlink != 0 {
				target, statErr := stat(name)
				if statErr != nil && !errors.Is(statErr, fs.ErrNotExist) {
					return result, statErr
				}
				isDirectory = statErr == nil && target.IsDir()
			}
			if directoriesOnly && !isDirectory {
				continue
			}
			if len(result.Entries) == 64 {
				result.Truncated = true
				break
			}
			result.Entries = append(result.Entries, CompletionPath{Name: name, Directory: isDirectory})
		}
		if result.Truncated || errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return result, err
		}
		if scanned >= 8192 {
			result.Truncated = true
		}
	}
	sort.Slice(result.Entries, func(i, j int) bool {
		if result.Entries[i].Directory != result.Entries[j].Directory {
			return result.Entries[i].Directory
		}
		return result.Entries[i].Name < result.Entries[j].Name
	})
	return result, nil
}
