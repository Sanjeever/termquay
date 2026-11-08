package backup

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/net/webdav"
)

func TestPrunePreviewScopeVersionsAndConcurrentAppend(t *testing.T) {
	root := t.TempDir()
	handler := &webdav.Handler{FileSystem: webdav.Dir(root), LockSystem: webdav.NewMemLS()}
	conditional := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete && r.Header.Get("If-Match") != "" {
			conditional++
		}
		handler.ServeHTTP(w, r)
	}))
	defer server.Close()
	opts := WebDAVOptions{URL: server.URL, Directory: "backups"}
	if err := os.MkdirAll(filepath.Join(root, "backups", "device"), 0700); err != nil {
		t.Fatal(err)
	}
	write := func(day int) string {
		name := fmt.Sprintf("202601%02dT000000.000000000Z_%032d.json.age", day, day)
		if err := os.WriteFile(filepath.Join(root, "backups", "device", name), []byte("version-test"), 0600); err != nil {
			t.Fatal(err)
		}
		return name
	}
	first := write(1)
	write(2)
	write(3)
	write(4)
	if err := os.WriteFile(filepath.Join(root, "backups", "device", "unrelated.json.age"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	keep, remove, remaining, skipped, err := opts.PlanPrune(context.Background(), "device", 2)
	if err != nil || len(keep) != 2 || len(remove) != 2 || remaining != 0 || skipped != 1 || !strings.Contains(keep[0].Path, "20260104") {
		t.Fatalf("清理预览范围错误: %+v %+v %v", keep, remove, err)
	}
	write(5)
	for _, item := range remove {
		if err := opts.DeletePreviewedSnapshot(context.Background(), item); err != nil {
			t.Fatal(err)
		}
	}
	if conditional != 2 {
		t.Fatal("删除未携带 ETag 条件")
	}
	if _, err := os.Stat(filepath.Join(root, "backups", "device", first)); !os.IsNotExist(err) {
		t.Fatal("旧快照未删除")
	}
	if _, err := os.Stat(filepath.Join(root, "backups", "device", "unrelated.json.age")); err != nil {
		t.Fatal("清理误删未知文件")
	}
	_, remove, _, _, err = opts.PlanPrune(context.Background(), "device", 1)
	if err != nil || len(remove) != 2 {
		t.Fatalf("并发追加被纳入原删除集合: %v", err)
	}
	item := remove[0]
	if err := os.WriteFile(filepath.Join(root, item.Path), []byte("changed-version-after-preview"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := opts.DeletePreviewedSnapshot(context.Background(), item); err == nil {
		t.Fatal("删除了预览后变化的快照")
	}
	if _, _, _, _, err := opts.PlanPrune(context.Background(), "../other", 0); err == nil {
		t.Fatal("接受越界设备或零保留数量")
	}
}
