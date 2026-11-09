package monitor

import (
	"encoding/json"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	"strings"
	"time"
)

const FileSystemScript = "set -eu\nLC_ALL=C findmnt --json --bytes --df --output SOURCE,TARGET,FSTYPE,SIZE,USED,AVAIL\n"

type FileSystem struct {
	Source    string `json:"source"`
	Target    string `json:"target"`
	Type      string `json:"type"`
	Size      uint64 `json:"size"`
	Used      uint64 `json:"used"`
	Available uint64 `json:"available"`
}

type FileSystemSample struct {
	Time         time.Time              `json:"time"`
	Items        []FileSystem           `json:"items"`
	Error        string                 `json:"error"`
	ErrorMessage *appmessage.Descriptor `json:"error_message,omitempty"`
}

func ParseFileSystems(data []byte) ([]FileSystem, error) {
	var result struct {
		Items []struct {
			Source string  `json:"source"`
			Target string  `json:"target"`
			Type   string  `json:"fstype"`
			Size   *uint64 `json:"size"`
			Used   *uint64 `json:"used"`
			Avail  *uint64 `json:"avail"`
		} `json:"filesystems"`
	}
	if len(data) > 256<<10 {
		return nil, appmessage.New("backend:filesystemCapacityOutputExceeds256KiB", "文件系统容量输出超过 256 KiB")
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, err
	}
	if len(result.Items) == 0 || len(result.Items) > 128 {
		return nil, appmessage.New("backend:filesystemCountMustBeFrom1To128", "文件系统数量须在 1 至 128 之间")
	}
	items := make([]FileSystem, 0, len(result.Items))
	for _, item := range result.Items {
		if item.Source == "" || !strings.HasPrefix(item.Target, "/") || len(item.Target) > 4096 || item.Type == "" || item.Size == nil || item.Used == nil || item.Avail == nil || *item.Size == 0 || *item.Used > *item.Size || *item.Avail > *item.Size {
			return nil, appmessage.New("backend:filesystemCapacityDataInvalidOrMissing", "文件系统容量数据无效或缺失")
		}
		items = append(items, FileSystem{Source: item.Source, Target: item.Target, Type: item.Type, Size: *item.Size, Used: *item.Used, Available: *item.Avail})
	}
	return items, nil
}
