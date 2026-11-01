package backup

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Sanjeever/termquay/internal/store"
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
	if err = uploadSnapshot(c, remote, []byte("must-not-overwrite")); err == nil {
		t.Fatal("服务端没有拒绝同名覆盖")
	}
	after, err := opts.Read(ctx, remote)
	if err != nil {t.Fatalf("覆盖拒绝后的密文读取失败: %v",err)}
	if !bytes.Equal(after, encrypted) {
		t.Fatal("条件上传覆盖已有快照")
	}
}

func TestRealWebDAV(t *testing.T) {
	if os.Getenv("TERMQUAY_WEBDAV_PASSWORD") == "" {
		t.Skip("未注入真实 WebDAV 测试凭据")
	}
	opts := WebDAVOptions{URL: os.Getenv("TERMQUAY_WEBDAV_URL"), Username: os.Getenv("TERMQUAY_WEBDAV_USERNAME"), Password: os.Getenv("TERMQUAY_WEBDAV_PASSWORD"), Directory: fmt.Sprintf("termquay-test-%d", time.Now().UnixNano())}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	c, err := opts.client(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = c.Stat(opts.Directory); err == nil {
		t.Fatal("测试目录已存在")
	}
	entries, err := c.ReadDir("")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.IsDir() && entry.Name() == "我的坚果云" {
			opts.Directory = "我的坚果云/" + opts.Directory
			break
		}
	}
	if err = c.Mkdir(opts.Directory, 0700); err != nil {
		req, _ := http.NewRequestWithContext(ctx, "PROPFIND", opts.URL, nil)
		req.SetBasicAuth(opts.Username, opts.Password)
		req.Header.Set("Depth", "0")
		response, diagnosticErr := http.DefaultClient.Do(req)
		if diagnosticErr == nil {
			defer response.Body.Close()
			body, _ := io.ReadAll(io.LimitReader(response.Body, 1024))
			message := strings.ReplaceAll(strings.ReplaceAll(string(body), opts.Password, "[已隐藏]"), opts.Username, "[已隐藏]")
			t.Logf("只读 WebDAV 诊断 HTTP %d: %s", response.StatusCode, message)
		}
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
