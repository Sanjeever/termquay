package app

import (
	"context"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/Sanjeever/termquay/internal/backup"
	"golang.org/x/net/webdav"
)

func TestSnapshotPruneRequiresCurrentPreviewAndLocation(t *testing.T) {
	a := testAppStore(t)
	root := t.TempDir()
	server := httptest.NewServer(&webdav.Handler{FileSystem: webdav.Dir(root), LockSystem: webdav.NewMemLS()})
	defer server.Close()
	if err := os.MkdirAll(filepath.Join(root, "backups", "device"), 0700); err != nil {
		t.Fatal(err)
	}
	for day := 1; day <= 3; day++ {
		name := fmt.Sprintf("202601%02dT000000.000000000Z_%032d.json.age", day, day)
		if err := os.WriteFile(filepath.Join(root, "backups", "device", name), nil, 0600); err != nil {
			t.Fatal(err)
		}
	}
	a.automaticLoaded = true
	a.automaticConfig = &automaticBackupConfig{Options: backup.WebDAVOptions{URL: server.URL, Directory: "backups"}, Paused: true}
	p, err := a.PreviewSnapshotPrune(context.Background(), "device", 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.ConfirmSnapshotPrune(context.Background(), "wrong"); err == nil {
		t.Fatal("错误预览允许删除")
	}
	a.automaticConfig.Options.Directory = "other"
	if _, err := a.ConfirmSnapshotPrune(context.Background(), p.ID); err == nil {
		t.Fatal("修改位置后旧预览允许删除")
	}
	a.automaticConfig.Options.Directory = "backups"
	result, err := a.ConfirmSnapshotPrune(context.Background(), p.ID)
	if err != nil || len(result) != 2 {
		t.Fatalf("清理失败: %+v %v", result, err)
	}
	for _, item := range result {
		if item.State != "done" {
			t.Fatalf("删除未完成: %+v", item)
		}
	}
	if _, err := a.ConfirmSnapshotPrune(context.Background(), p.ID); err == nil {
		t.Fatal("重复预览允许再次删除")
	}
}
