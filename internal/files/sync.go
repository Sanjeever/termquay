package files

import (
	"context"
	"errors"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	sftp "github.com/pkg/sftp/v2"
)

const MaxSyncEntries = 10000
const MaxSyncDepth = 64
const MaxSyncPathBytes = 8 << 20

type SyncNode struct {
	Size     int64
	Modified int64
	Mode     fs.FileMode
}
type SyncEntry struct {
	Path      string `json:"path"`
	Directory bool   `json:"directory"`
	State     string `json:"state"`
	Size      int64  `json:"size"`
}

func (n SyncNode) Supported() bool {
	return n.Mode&os.ModeSymlink == 0 && (n.Mode.IsRegular() || n.Mode.IsDir())
}
func SyncInfo(info fs.FileInfo) SyncNode {
	return SyncNode{Size: info.Size(), Modified: info.ModTime().Unix(), Mode: info.Mode()}
}
func SameSyncNode(a, b SyncNode) bool {
	return a.Mode == b.Mode && (a.Mode.IsDir() || (a.Size == b.Size && a.Modified == b.Modified))
}
func validSyncRelative(value string) bool {
	return value != "" && value != "." && fs.ValidPath(value) && !strings.ContainsAny(value, "\\\x00\r\n:") && len(value) <= 4096 && strings.Count(value, "/") < MaxSyncDepth
}
func ScanLocalSync(ctx context.Context, root string, exclude ...string) (string, map[string]SyncNode, error) {
	root, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", nil, err
	}
	root, err = filepath.Abs(root)
	if err != nil {
		return "", nil, err
	}
	info, err := os.Lstat(root)
	if err != nil {
		return "", nil, err
	}
	if !info.IsDir() {
		return "", nil, errors.New("同步根必须是目录")
	}
	nodes := map[string]SyncNode{}
	pathBytes := 0
	pending := []string{""}
	for len(pending) > 0 {
		relative := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		directory, err := os.Open(filepath.Join(root, filepath.FromSlash(relative)))
		if err != nil {
			return "", nil, err
		}
		for {
			if err = ctx.Err(); err != nil {
				directory.Close()
				return "", nil, err
			}
			entries, readErr := directory.ReadDir(128)
			for _, entry := range entries {
				name := path.Join(relative, entry.Name())
				if ExcludedSyncPath(name, exclude) {
					continue
				}
				pathBytes += len(name)
				if entry.Name() != path.Base(entry.Name()) || !validSyncRelative(name) || len(nodes) >= MaxSyncEntries || pathBytes > MaxSyncPathBytes {
					directory.Close()
					return "", nil, errors.New("同步路径无效或超过扫描上限（10000 项、64 层、8 MiB 路径）")
				}
				info, err := entry.Info()
				if err != nil {
					directory.Close()
					return "", nil, err
				}
				node := SyncInfo(info)
				nodes[name] = node
				if node.Supported() && info.IsDir() {
					pending = append(pending, name)
				}
			}
			if readErr != nil {
				directory.Close()
				if !errors.Is(readErr, io.EOF) {
					return "", nil, readErr
				}
				break
			}
		}
	}
	return root, nodes, nil
}
func ScanRemoteSync(ctx context.Context, client *sftp.Client, root string, exclude ...string) (string, map[string]SyncNode, error) {
	root, err := client.RealPath(root)
	if err != nil {
		return "", nil, err
	}
	info, err := client.LStat(root)
	if err != nil {
		return "", nil, err
	}
	if !info.IsDir() {
		return "", nil, errors.New("同步根必须是目录")
	}
	nodes := map[string]SyncNode{}
	pathBytes := 0
	pending := []string{""}
	for len(pending) > 0 {
		relative := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		directory, err := client.OpenDir(path.Join(root, relative))
		if err != nil {
			return "", nil, err
		}
		for {
			entries, readErr := directory.ReaddirContext(ctx, 128)
			for _, info := range entries {
				if info.Name() == "." || info.Name() == ".." {
					continue
				}
				name := path.Join(relative, info.Name())
				if ExcludedSyncPath(name, exclude) {
					continue
				}
				pathBytes += len(name)
				if info.Name() != path.Base(info.Name()) || !validSyncRelative(name) || len(nodes) >= MaxSyncEntries || pathBytes > MaxSyncPathBytes {
					directory.Close()
					return "", nil, errors.New("同步路径无效或超过扫描上限（10000 项、64 层、8 MiB 路径）")
				}
				node := SyncInfo(info)
				nodes[name] = node
				if node.Supported() && info.IsDir() {
					pending = append(pending, name)
				}
			}
			if readErr != nil {
				directory.Close()
				if !errors.Is(readErr, io.EOF) {
					return "", nil, readErr
				}
				break
			}
		}
	}
	return root, nodes, nil
}
func CompareSync(source, target map[string]SyncNode) []SyncEntry {
	result := make([]SyncEntry, 0, len(source))
	for name, node := range source {
		state := "new"
		old, exists := target[name]
		if !node.Supported() || (exists && (!old.Supported() || node.Mode.IsDir() != old.Mode.IsDir())) {
			state = "conflict"
		} else if exists {
			if node.Mode.IsDir() || node.Size == old.Size && node.Modified == old.Modified {
				state = "same"
			} else {
				state = "update"
			}
		}
		for parent := path.Dir(name); parent != "."; parent = path.Dir(parent) {
			if value, ok := target[parent]; ok && (!value.Mode.IsDir() || !value.Supported()) {
				state = "conflict"
				break
			}
		}
		result = append(result, SyncEntry{Path: name, Directory: node.Mode.IsDir(), State: state, Size: node.Size})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Path < result[j].Path })
	return result
}
func CheckLocalSyncPath(root, relative string, createParents bool) error {
	if !validSyncRelative(relative) {
		return errors.New("同步路径越界")
	}
	current := root
	parts := strings.Split(relative, "/")
	for _, part := range parts[:len(parts)-1] {
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if os.IsNotExist(err) && createParents {
			err = os.Mkdir(current, 0700)
			if err != nil {
				return err
			}
			info, err = os.Lstat(current)
		}
		if err != nil {
			return err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return errors.New("同步父路径不是普通目录")
		}
	}
	return nil
}
