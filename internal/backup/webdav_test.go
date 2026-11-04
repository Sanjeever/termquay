package backup

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Sanjeever/termquay/internal/store"
	"github.com/studio-b12/gowebdav"
	"golang.org/x/net/webdav"
)

func TestWebDAVConditionalAppendAndRead(t *testing.T) {
	dir := t.TempDir()
	handler := &webdav.Handler{FileSystem: webdav.Dir(dir), LockSystem: webdav.NewMemLS()}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPut && r.Header.Get("If-None-Match") == "*" {
			if _, err := os.Stat(filepath.Join(dir, r.URL.Path)); err == nil {
				w.WriteHeader(http.StatusPreconditionFailed)
				return
			}
		}
		handler.ServeHTTP(w, r)
	}))
	defer server.Close()
	opts := WebDAVOptions{URL: server.URL, Directory: "termquay/backups"}
	if err := opts.Check(context.Background()); err != nil {
		t.Fatal("目标目录完整检查失败", err)
	}
	exerciseWebDAV(t, opts)
	if _, err := opts.Read(context.Background(), "../outside.json.age"); err == nil {
		t.Fatal("允许备份目录外读取")
	}
}

func exerciseWebDAV(t *testing.T, opts WebDAVOptions) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	encrypted, err := Encrypt(store.Data{}, "isolated-device", "local-test-recovery")
	if err != nil {
		t.Fatal(err)
	}
	remote, err := opts.Append(ctx, "isolated-device", encrypted)
	if err != nil {
		t.Fatal(err)
	}
	read, err := opts.Read(ctx, remote)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(read, encrypted) {
		t.Fatal("上传下载密文不一致")
	}
	if _, err = Decrypt(read, "local-test-recovery"); err != nil {
		t.Fatal(err)
	}
	list, err := opts.List(ctx)
	if err != nil || len(list) != 1 || list[0].Path != remote {
		t.Fatalf("快照列表无效: %v", err)
	}
	c, err := opts.client(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err = opts.uploadSnapshot(ctx, c, remote, []byte("must-not-overwrite")); err == nil {
		t.Fatal("服务端没有拒绝同名覆盖")
	}
	var status gowebdav.StatusError
	if !errors.As(err, &status) || (status.Status != http.StatusPreconditionFailed && status.Status != http.StatusConflict) {
		t.Fatalf("同名发布未被明确拒绝: %v", err)
	}
	after, err := opts.Read(ctx, remote)
	if err != nil {
		t.Fatalf("覆盖拒绝后的密文读取失败: %v", err)
	}
	if !bytes.Equal(after, encrypted) {
		t.Fatal("条件上传覆盖已有快照")
	}
}

func TestRealWebDAV(t *testing.T) {
	if os.Getenv("TERMQUAY_WEBDAV_PASSWORD") == "" {
		t.Skip("未注入真实 WebDAV 测试凭据")
	}
	opts := WebDAVOptions{URL: os.Getenv("TERMQUAY_WEBDAV_URL"), Username: os.Getenv("TERMQUAY_WEBDAV_USERNAME"), Password: os.Getenv("TERMQUAY_WEBDAV_PASSWORD"), Directory: path.Join(os.Getenv("TERMQUAY_WEBDAV_DIRECTORY"), fmt.Sprintf("termquay-test-%d", time.Now().UnixNano()))}
	transport := http.DefaultTransport
	http.DefaultTransport = &pacedTransport{base: transport}
	defer func() { http.DefaultTransport = transport }()
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	c, err := opts.client(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = c.Stat(opts.Directory); err == nil {
		t.Fatal("测试目录已存在")
	}
	if err = c.Mkdir(opts.Directory, 0700); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if !strings.HasPrefix(filepath.Base(opts.Directory), "termquay-test-") {
			t.Fatal("拒绝清理非本次测试目录")
		}
		if err := c.RemoveAll(opts.Directory); err != nil {
			t.Errorf("测试目录清理失败: %v", err)
		}
	}()
	exerciseWebDAV(t, opts)
	t.Log("真实 WebDAV 条件追加、密文往返、列表与解密通过，测试目录已安排清理")
}

type pacedTransport struct{ base http.RoundTripper }

func (p *pacedTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	timer := time.NewTimer(time.Second)
	defer timer.Stop()
	select {
	case <-r.Context().Done():
		return nil, r.Context().Err()
	case <-timer.C:
	}
	return p.base.RoundTrip(r)
}
