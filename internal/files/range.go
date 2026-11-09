package files

import (
	"encoding/json"
	"fmt"
	"io"

	"github.com/pkg/sftp"
)

type TextRange struct {
	Path       string `json:"path"`
	Content    string `json:"content"`
	Encoding   string `json:"encoding"`
	Revision   string `json:"revision"`
	Offset     int64  `json:"offset"`
	NextOffset *int64 `json:"next_offset"`
	FileBytes  int64  `json:"file_bytes"`
	Truncated  bool   `json:"truncated"`
}

func ReadRange(client *sftp.Client, remote, charset, revision string, offset int64, limit, budget int) (TextRange, error) {
	view := TextRange{Path: remote, Offset: offset}
	if offset < 0 || limit < 1 || limit > 8192 || budget < 1024 {
		return view, &ReadError{Code: "file_range", Message: "文件读取范围无效"}
	}
	info, err := client.Lstat(remote)
	if err != nil {
		return view, err
	}
	if !info.Mode().IsRegular() {
		return view, &ReadError{Code: "file_not_regular", Message: "读取范围需要普通文件，请使用实际目标路径"}
	}
	if info.Size() > MaxEditSize {
		return view, &ReadError{Code: "file_too_large", Message: "文件超过文本读取大小限制，请下载后查看"}
	}
	view.FileBytes = info.Size()
	view.Revision = fmt.Sprintf("%d:%d:%s", info.Size(), info.ModTime().Unix(), info.Mode())
	if revision != "" && revision != view.Revision {
		return view, &ReadError{Code: "file_changed", Message: "文件属性已变化，请从头重新读取"}
	}
	if offset > info.Size() {
		return view, &ReadError{Code: "file_range", Message: "读取起点超出文件大小"}
	}
	file, err := client.Open(remote)
	if err != nil {
		return view, err
	}
	defer file.Close()
	data := make([]byte, min(int64(limit), info.Size()-offset))
	n, err := file.ReadAt(data, offset)
	if err != nil && err != io.EOF {
		return view, err
	}
	data = data[:n]
	if int64(n) < min(int64(limit), info.Size()-offset) {
		return view, &ReadError{Code: "file_changed", Message: "文件在读取期间缩短，请重新读取"}
	}
	for {
		var decodeErr error
		for trim := 0; trim <= 3 && trim <= len(data); trim++ {
			if trim > 0 && offset+int64(len(data)) >= info.Size() {
				break
			}
			view.Content, view.Encoding, _, decodeErr = decodeText(data[:len(data)-trim], charset, offset == 0)
			if decodeErr == nil {
				data = data[:len(data)-trim]
				break
			}
		}
		if decodeErr != nil {
			return view, decodeErr
		}
		next := offset + int64(len(data))
		view.Truncated = next < info.Size()
		view.NextOffset = nil
		if view.Truncated {
			view.NextOffset = &next
		}
		encoded, err := json.Marshal(view)
		if err != nil {
			return view, err
		}
		if len(encoded) <= budget {
			if len(data) == 0 && view.Truncated {
				return view, &ReadError{Code: "file_range", Message: "读取字节数不足以容纳完整字符，请增大 limit"}
			}
			return view, nil
		}
		if len(data) < 4 {
			return view, &ReadError{Code: "file_range", Message: "文件路径超过输出预算"}
		}
		data = data[:len(data)/2]
	}
}
