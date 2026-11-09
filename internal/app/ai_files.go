package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path"
	"sort"
	"strings"

	"github.com/Sanjeever/termquay/internal/files"
)

const maxAIDirectoryScan = 16384

type aiDirectoryPage struct {
	Path        string        `json:"path"`
	Entries     []files.Entry `json:"entries"`
	Offset      int64         `json:"offset"`
	NextOffset  *int64        `json:"next_offset"`
	Truncated   bool          `json:"truncated"`
	Consistency string        `json:"consistency"`
}

func windowsAbsolutePath(value string) bool {
	return len(value) >= 3 && (value[0] >= 'A' && value[0] <= 'Z' || value[0] >= 'a' && value[0] <= 'z') && value[1] == ':' && (value[2] == '/' || value[2] == '\\')
}

func aiRemotePath(value, platform string) (string, error) {
	if windowsAbsolutePath(value) {
		if platform != "windows" {
			return "", errors.New("盘符绝对路径需要已识别的 Windows SSH 主机")
		}
		value = "/" + strings.ReplaceAll(value, "\\", "/")
	} else if platform == "windows" {
		value = strings.ReplaceAll(value, "\\", "/")
	}
	if !path.IsAbs(value) {
		return "", errors.New("文件工具需要远端绝对路径")
	}
	return path.Clean(value), nil
}

func (a *AppService) listAIFileDirectory(ctx context.Context, run *aiRun, args aiToolArguments) (aiDirectoryPage, error) {
	view := aiDirectoryPage{Entries: []files.Entry{}, Offset: args.Offset, Consistency: "live"}
	directory, err := aiRemotePath(args.Path, run.environment.OS)
	if err != nil {
		return view, err
	}
	if args.Offset > maxAIDirectoryScan {
		return view, &aiToolError{Code: "scan_limit", Message: "目录续读超过扫描预算，请按名称筛选"}
	}
	limit := args.Limit
	if limit == 0 {
		limit = 32
	}
	client, release, err := a.deleteClient(ctx, run.view.Workspace)
	if err != nil {
		return view, err
	}
	defer release()
	view.Path, err = client.RealPath(directory)
	if err != nil {
		return view, err
	}
	file, err := client.OpenDir(view.Path)
	if err != nil {
		return view, err
	}
	defer file.Close()
	scanned, nameBytes := 0, 0
	matched := []os.FileInfo{}
	search := strings.ToLower(args.Search)
	for {
		items, readErr := file.ReaddirContext(ctx, 128)
		for _, item := range items {
			if item.Name() == "." || item.Name() == ".." {
				continue
			}
			scanned++
			if scanned > maxAIDirectoryScan {
				return view, &aiToolError{Code: "scan_limit", Message: "目录超过扫描预算，请缩小目录或筛选范围"}
			}
			if !strings.Contains(strings.ToLower(item.Name()), search) {
				continue
			}
			nameBytes += len(item.Name())
			if nameBytes > 4<<20 {
				return view, &aiToolError{Code: "scan_limit", Message: "目录名称超过扫描字节预算，请缩小目录或筛选范围"}
			}
			matched = append(matched, item)
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return view, readErr
		}
	}
	sort.Slice(matched, func(i, j int) bool { return matched[i].Name() < matched[j].Name() })
	for index := min(int(args.Offset), len(matched)); index < len(matched) && len(view.Entries) < limit; index++ {
		item := matched[index]
		entry := files.Entry{Name: item.Name(), Path: path.Join(view.Path, item.Name()), Directory: item.IsDir(), Symlink: item.Mode()&os.ModeSymlink != 0, Size: item.Size(), Mode: item.Mode().String(), Modified: item.ModTime().UnixMilli()}
		view.Entries = append(view.Entries, entry)
		b, err := json.Marshal(view)
		if err != nil {
			return view, err
		}
		if len(b) > maxAIToolResultBytes-128 {
			view.Entries = view.Entries[:len(view.Entries)-1]
			if len(view.Entries) == 0 {
				return view, &aiToolError{Code: "result_too_large", Message: "单个目录条目超过 AI 输出预算"}
			}
			break
		}
	}
	next := args.Offset + int64(len(view.Entries))
	if next < int64(len(matched)) {
		view.NextOffset = &next
		view.Truncated = true
	}
	return view, nil
}

func (a *AppService) readAIFileRange(ctx context.Context, run *aiRun, args aiToolArguments) (files.TextRange, error) {
	remote, err := aiRemotePath(args.Path, run.environment.OS)
	if err != nil {
		return files.TextRange{}, err
	}
	limit := args.Limit
	if limit == 0 {
		limit = 4096
	}
	client, release, err := a.fileClient(ctx, run.view.Workspace)
	if err != nil {
		return files.TextRange{}, err
	}
	defer release()
	return files.ReadRange(client, remote, args.Encoding, args.Revision, args.Offset, limit, maxAIToolResultBytes)
}
