package files

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"sort"
	"sync"

	"github.com/pkg/sftp"
)

const MaxEditSize = 2 << 20

type Entry struct {
	Name         string  `json:"name"`
	Path         string  `json:"path"`
	Size         int64   `json:"size"`
	Directory    bool    `json:"directory"`
	Symlink      bool    `json:"symlink"`
	Mode         string  `json:"mode"`
	Modified     int64   `json:"modified"`
	UID          *uint32 `json:"uid,omitempty"`
	GID          *uint32 `json:"gid,omitempty"`
	LinkTarget   string  `json:"link_target,omitempty"`
	LinkResolved string  `json:"link_resolved,omitempty"`
	LinkError    string  `json:"link_error,omitempty"`
}
type Document struct {
	Path       string `json:"path"`
	Content    string `json:"content"`
	Revision   string `json:"revision"`
	Encoding   string `json:"encoding,omitempty"`
	LineEnding string `json:"line_ending,omitempty"`
	BOM        bool   `json:"bom,omitempty"`
}

type Directory struct {
	Path    string  `json:"path"`
	Entries []Entry `json:"entries"`
}

func List(ctx context.Context, client *sftp.Client, remote string) (Directory, error) {
	if remote == "" {
		var err error
		remote, err = client.Getwd()
		if err != nil {
			return Directory{}, err
		}
	}
	canonical, err := client.RealPath(remote)
	if err != nil {
		return Directory{}, err
	}
	if !path.IsAbs(remote) {
		remote = canonical
	}
	remote = path.Clean(remote)
	if canonical != remote {
		for ancestor := path.Dir(remote); ; ancestor = path.Dir(ancestor) {
			resolved, err := client.RealPath(ancestor)
			if err != nil {
				return Directory{}, err
			}
			if resolved == canonical {
				return Directory{}, errors.New("符号链接指向祖先目录，已阻止循环展开")
			}
			if ancestor == "/" {
				break
			}
		}
	}
	infos, err := client.ReadDirContext(ctx, remote)
	if err != nil {
		return Directory{}, err
	}
	result := make([]Entry, 0, len(infos))
	var links []int
	for _, info := range infos {
		entry := Entry{Name: info.Name(), Path: path.Join(remote, info.Name()), Size: info.Size(), Directory: info.IsDir(), Symlink: info.Mode()&os.ModeSymlink != 0, Mode: info.Mode().String(), Modified: info.ModTime().UnixMilli()}
		if stat, ok := info.Sys().(*sftp.FileStat); ok {
			entry.UID = &stat.UID
			entry.GID = &stat.GID
		}
		result = append(result, entry)
		if entry.Symlink {
			links = append(links, len(result)-1)
		}
	}
	var workers sync.WaitGroup
	jobs := make(chan int)
	for range min(4, len(links)) {
		workers.Go(func() {
			for index := range jobs {
				entry := &result[index]
				var err error
				entry.LinkTarget, err = client.ReadLink(entry.Path)
				if err == nil {
					var target os.FileInfo
					target, err = client.Stat(entry.Path)
					if err == nil {
						entry.Directory = target.IsDir()
						entry.LinkResolved, err = client.RealPath(entry.Path)
					}
				}
				if err != nil {
					entry.LinkError = err.Error()
				}
			}
		})
	}
	for _, index := range links {
		select {
		case jobs <- index:
		case <-ctx.Done():
			close(jobs)
			workers.Wait()
			return Directory{}, ctx.Err()
		}
	}
	close(jobs)
	workers.Wait()
	sort.Slice(result, func(i, j int) bool {
		if result[i].Directory != result[j].Directory {
			return result[i].Directory
		}
		return result[i].Name < result[j].Name
	})
	return Directory{Path: remote, Entries: result}, nil
}

func Read(client *sftp.Client, remote string) (Document, error) {
	return ReadEncoded(client, remote, "UTF-8")
}

func ReadEncoded(client *sftp.Client, remote, charset string) (Document, error) {
	document, data, err := readRaw(client, remote)
	if err != nil {
		return Document{}, err
	}
	document.Content, document.Encoding, document.BOM, err = DecodeText(data, charset)
	if err != nil {
		return Document{}, err
	}
	document.LineEnding = LineEnding(document.Content)
	return document, nil
}

func readRaw(client *sftp.Client, remote string) (Document, []byte, error) {
	info, err := client.Lstat(remote)
	if err != nil {
		return Document{}, nil, err
	}
	if !info.Mode().IsRegular() {
		return Document{}, nil, &ReadError{Code: "file_not_regular", Message: "编辑器支持普通文件，符号链接需使用实际目标路径"}
	}
	if info.Size() > MaxEditSize {
		return Document{}, nil, &ReadError{Code: "file_too_large", Message: "在线编辑文件不能超过 2 MiB，请下载后编辑"}
	}
	f, err := client.Open(remote)
	if err != nil {
		return Document{}, nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, MaxEditSize+1))
	if err != nil {
		return Document{}, nil, err
	}
	if len(data) > MaxEditSize {
		return Document{}, nil, &ReadError{Code: "file_too_large", Message: "文件超过在线编辑限制，请下载后编辑"}
	}
	sum := sha256.Sum256(data)
	attributes, ok := info.Sys().(*sftp.FileStat)
	if !ok {
		return Document{}, nil, errors.New("服务端未提供可识别的文件属性")
	}
	return Document{Path: remote, Revision: hex.EncodeToString(sum[:]) + ":" + fmt.Sprint(info.ModTime().Unix(), ":", info.Mode(), ":", attributes.UID, ":", attributes.GID)}, data, nil
}

func Save(client *sftp.Client, document Document) (result Document, err error) {
	data, err := EncodeDocument(document)
	if err != nil {
		return result, err
	}
	current, _, err := readRaw(client, document.Path)
	if err != nil {
		return result, err
	}
	if current.Revision != document.Revision {
		return result, errors.New("远端文件已变化，请重新读取后比较，当前草稿已保留")
	}
	if _, ok := client.HasExtension("posix-rename@openssh.com"); !ok {
		return result, errors.New("服务端不支持 POSIX rename，无法安全替换文件")
	}
	info, err := client.Lstat(document.Path)
	if err != nil {
		return result, err
	}
	if info.Mode()&(os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != 0 {
		return result, errors.New("在线保存不支持含特殊权限位的文件")
	}
	attributes, ok := info.Sys().(*sftp.FileStat)
	if !ok {
		return result, errors.New("服务端未提供可识别的文件属性")
	}
	staging, err := CreateStaging(client, path.Dir(document.Path))
	if err != nil {
		return result, err
	}
	defer func() {
		cleanupErr := RemoveStaging(client, staging)
		if err == nil && cleanupErr != nil {
			err = fmt.Errorf("文件已保存，但临时目录清理失败: %w", cleanupErr)
		} else {
			err = errors.Join(err, cleanupErr)
		}
	}()
	temporary := path.Join(staging, "data")
	f, err := client.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL)
	if err != nil {
		return result, err
	}
	if _, err = f.Write(data); err != nil {
		f.Close()
		return result, err
	}
	if err = f.Chown(int(attributes.UID), int(attributes.GID)); err != nil {
		f.Close()
		return result, fmt.Errorf("无法保留文件属主与用户组: %w", err)
	}
	if err = f.Chmod(info.Mode().Perm()); err != nil {
		f.Close()
		return result, err
	}
	if err = f.Close(); err != nil {
		return result, err
	}
	latest, _, err := readRaw(client, document.Path)
	if err != nil {
		return result, err
	}
	if latest.Revision != document.Revision {
		return result, errors.New("保存期间远端文件已变化，当前草稿已保留")
	}
	if err = client.PosixRename(temporary, document.Path); err != nil {
		return result, err
	}
	result, err = ReadEncoded(client, document.Path, document.Encoding)
	if err == nil && (document.LineEnding == "LF" || document.LineEnding == "CRLF") {
		result.LineEnding = document.LineEnding
	}
	return result, err
}
