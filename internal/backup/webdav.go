package backup

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/studio-b12/gowebdav"
)

type WebDAVOptions struct {
	URL       string `json:"url"`
	Username  string `json:"username"`
	Password  string `json:"password"`
	Directory string `json:"directory"`
}

type RemoteSnapshot struct {
	Path     string    `json:"path"`
	Size     int64     `json:"size"`
	Modified time.Time `json:"modified"`
}

func (o WebDAVOptions) client(ctx context.Context) (*gowebdav.Client, error) {
	u, err := url.Parse(o.URL)
	if err != nil {
		return nil, errors.New("WebDAV 地址无效")
	}
	loopback := net.ParseIP(u.Hostname())
	if u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "https" && !(u.Scheme == "http" && loopback != nil && loopback.IsLoopback())) {
		return nil, errors.New("WebDAV 必须使用 HTTPS（本机隔离测试允许回环 HTTP）")
	}
	if o.Directory == "" || strings.HasPrefix(o.Directory, "/") || path.Clean(o.Directory) != o.Directory || o.Directory == "." || strings.HasPrefix(o.Directory, "..") {
		return nil, errors.New("WebDAV 备份目录必须是有效相对路径")
	}
	c := gowebdav.NewAuthClient(o.URL, gowebdav.NewEmptyAuth())
	c.SetTimeout(30 * time.Second)
	c.SetHeader(gowebdav.XInhibitRedirect, "1")
	c.SetInterceptor(func(method string, r *http.Request) {
		*r = *r.WithContext(ctx)
		r.SetBasicAuth(o.Username, o.Password)
		if method == http.MethodPut {
			r.Header.Set("If-None-Match", "*")
			r.Header.Set("Content-Type", "application/octet-stream")
		}
	})
	return c, nil
}

func (o WebDAVOptions) Test(ctx context.Context) error {
	c, err := o.client(ctx)
	if err != nil {
		return err
	}
	_, err = c.ReadDir("")
	return err
}

func (o WebDAVOptions) Append(ctx context.Context, deviceID string, encrypted []byte) (string, error) {
	if !regexp.MustCompile(`^[a-zA-Z0-9_-]{1,100}$`).MatchString(deviceID) {
		return "", errors.New("设备标识无效")
	}
	if len(encrypted) > MaxSnapshot+(1<<20) {
		return "", errors.New("加密快照超过限制")
	}
	c, err := o.client(ctx)
	if err != nil {
		return "", err
	}
	dir := path.Join(o.Directory, deviceID)
	if err = c.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	var id [16]byte
	if _, err = rand.Read(id[:]); err != nil {
		return "", err
	}
	name := time.Now().UTC().Format("20060102T150405.000000000Z") + "_" + hex.EncodeToString(id[:]) + ".json.age"
	remote := path.Join(dir, name)
	if err = uploadSnapshot(c, remote, encrypted); err != nil {
		return "", err
	}
	return remote, nil
}

func uploadSnapshot(c *gowebdav.Client, remote string, encrypted []byte) (result error) {
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return err
	}
	stage := remote + ".upload-" + hex.EncodeToString(id[:])
	if err := c.WriteStreamWithLength(stage, bytes.NewReader(encrypted), int64(len(encrypted)), 0600); err != nil {
		return err
	}
	defer func() {
		if result != nil {
			result = errors.Join(result, c.Remove(stage))
		}
	}()
	return c.Rename(stage, remote, false)
}

func (o WebDAVOptions) List(ctx context.Context) ([]RemoteSnapshot, error) {
	c, err := o.client(ctx)
	if err != nil {
		return nil, err
	}
	devices, err := c.ReadDir(o.Directory)
	if err != nil {
		return nil, err
	}
	if len(devices) > 1000 {
		return nil, errors.New("备份设备目录超过 1000 个")
	}
	result := []RemoteSnapshot{}
	for _, device := range devices {
		if !device.IsDir() {
			continue
		}
		entries, err := c.ReadDir(path.Join(o.Directory, device.Name()))
		if err != nil {
			return nil, err
		}
		for _, entry := range entries {
			if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".json.age") {
				result = append(result, RemoteSnapshot{Path: path.Join(o.Directory, device.Name(), entry.Name()), Size: entry.Size(), Modified: entry.ModTime()})
				if len(result) > 10000 {
					return nil, errors.New("快照超过 10000 个")
				}
			}
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Modified.After(result[j].Modified) })
	return result, nil
}

func (o WebDAVOptions) Read(ctx context.Context, remote string) ([]byte, error) {
	if path.Clean(remote) != remote || !strings.HasPrefix(remote, o.Directory+"/") || !strings.HasSuffix(remote, ".json.age") {
		return nil, errors.New("快照路径不在备份目录内")
	}
	c, err := o.client(ctx)
	if err != nil {
		return nil, err
	}
	r, err := c.ReadStream(remote)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	data, err := io.ReadAll(io.LimitReader(r, MaxSnapshot+(1<<20)+1))
	if err != nil {
		return nil, err
	}
	if len(data) > MaxSnapshot+(1<<20) {
		return nil, fmt.Errorf("远端快照超过限制")
	}
	return data, nil
}
