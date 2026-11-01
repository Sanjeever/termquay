package files

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"sort"
	"unicode/utf8"

	"github.com/pkg/sftp"
)

const MaxEditSize = 2 << 20

type Entry struct {
	Name      string `json:"name"`
	Path      string `json:"path"`
	Size      int64  `json:"size"`
	Directory bool   `json:"directory"`
	Symlink   bool   `json:"symlink"`
	Mode      string `json:"mode"`
}
type Document struct {
	Path     string `json:"path"`
	Content  string `json:"content"`
	Revision string `json:"revision"`
}

func List(ctx context.Context, client *sftp.Client, remote string) ([]Entry, error) {
	if remote == "" {
		var err error
		remote, err = client.Getwd()
		if err != nil {
			return nil, err
		}
	}
	infos, err := client.ReadDirContext(ctx, remote)
	if err != nil {
		return nil, err
	}
	result := make([]Entry, 0, len(infos))
	for _, info := range infos {
		result = append(result, Entry{Name: info.Name(), Path: path.Join(remote, info.Name()), Size: info.Size(), Directory: info.IsDir(), Symlink: info.Mode()&os.ModeSymlink != 0, Mode: info.Mode().String()})
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Directory != result[j].Directory {
			return result[i].Directory
		}
		return result[i].Name < result[j].Name
	})
	return result, nil
}

func Read(client *sftp.Client, remote string) (Document, error) {
	info, err := client.Lstat(remote)
	if err != nil {
		return Document{}, err
	}
	if !info.Mode().IsRegular() {
		return Document{}, errors.New("编辑器支持普通文件，符号链接需使用实际目标路径")
	}
	if info.Size() > MaxEditSize {
		return Document{}, errors.New("在线编辑文件不能超过 2 MiB，请下载后编辑")
	}
	f, err := client.Open(remote)
	if err != nil {
		return Document{}, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, MaxEditSize+1))
	if err != nil {
		return Document{}, err
	}
	if len(data) > MaxEditSize {
		return Document{}, errors.New("文件超过在线编辑限制")
	}
	if !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
		return Document{}, errors.New("文件不是可编辑的 UTF-8 文本")
	}
	sum := sha256.Sum256(data)
	return Document{Path: remote, Content: string(data), Revision: hex.EncodeToString(sum[:]) + ":" + fmt.Sprint(info.ModTime().Unix(), ":", info.Mode().Perm())}, nil
}

func Save(client *sftp.Client, document Document) (result Document, err error) {
	if len(document.Content) > MaxEditSize || !utf8.ValidString(document.Content) || bytes.IndexByte([]byte(document.Content), 0) >= 0 {
		return result, errors.New("内容不是有效 UTF-8 文本或超过 2 MiB")
	}
	current, err := Read(client, document.Path)
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
	var token [16]byte
	if _, err = rand.Read(token[:]); err != nil {
		return result, err
	}
	temporary := path.Join(path.Dir(document.Path), ".termquay-"+hex.EncodeToString(token[:]))
	f, err := client.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL)
	if err != nil {
		return result, err
	}
	published := false
	defer func() {
		if !published {
			err = errors.Join(err, client.Remove(temporary))
		}
	}()
	if _, err = io.WriteString(f, document.Content); err != nil {
		f.Close()
		return result, err
	}
	if err = f.Chmod(info.Mode().Perm()); err != nil {
		f.Close()
		return result, err
	}
	if err = f.Close(); err != nil {
		return result, err
	}
	latest, err := Read(client, document.Path)
	if err != nil {
		return result, err
	}
	if latest.Revision != document.Revision {
		return result, errors.New("保存期间远端文件已变化，当前草稿已保留")
	}
	if err = client.PosixRename(temporary, document.Path); err != nil {
		return result, err
	}
	published = true
	return Read(client, document.Path)
}
