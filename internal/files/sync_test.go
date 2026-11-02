package files

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestSyncComparisonAndTraversal(t *testing.T) {
	source := map[string]SyncNode{"new": {Size: 3, Modified: 1, Mode: 0600}, "changed": {Size: 4, Modified: 2, Mode: 0600}, "same": {Size: 5, Modified: 3, Mode: 0600}, "dir": {Mode: os.ModeDir | 0700}, "dir/child": {Mode: 0600}, "link": {Mode: os.ModeSymlink | 0777}}
	target := map[string]SyncNode{"changed": {Size: 3, Modified: 1, Mode: 0600}, "same": {Size: 5, Modified: 3, Mode: 0644}, "dir": {Mode: 0600}, "extra": {Mode: 0600}}
	states := map[string]string{}
	for _, entry := range CompareSync(source, target) {
		states[entry.Path] = entry.State
	}
	if states["new"] != "new" || states["changed"] != "update" || states["same"] != "same" || states["dir/child"] != "conflict" || states["link"] != "conflict" {
		t.Fatal("差异预览不正确")
	}
	if _, exists := states["extra"]; exists {
		t.Fatal("多余目标进入同步计划")
	}
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "dir"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "dir", "test.txt"), []byte("test"), 0600); err != nil {
		t.Fatal(err)
	}
	_, nodes, err := ScanLocalSync(context.Background(), root)
	if err != nil || len(nodes) != 2 {
		t.Fatalf("本地扫描失败: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err = ScanLocalSync(ctx, root); !errors.Is(err, context.Canceled) {
		t.Fatal("取消未停止扫描")
	}
	for _, relative := range []string{"../escape", "/absolute", "a/../../escape", "a\\escape", "a:b"} {
		if err = CheckLocalSyncPath(root, relative, false); err == nil {
			t.Fatal("接受越界路径")
		}
	}
}
func TestSyncDepthLimit(t *testing.T) {
	root := t.TempDir()
	current := root
	for range MaxSyncDepth + 1 {
		current = filepath.Join(current, "a")
		if err := os.Mkdir(current, 0700); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := ScanLocalSync(context.Background(), root); err == nil {
		t.Fatal("扫描超过深度上限")
	}
}
func TestSyncDoesNotFollowLocalSymlinks(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "link")); err != nil {
		t.Skip("当前环境无法创建符号链接")
	}
	if err := os.WriteFile(filepath.Join(outside, "outside.txt"), []byte("test"), 0600); err != nil {
		t.Fatal(err)
	}
	_, nodes, err := ScanLocalSync(context.Background(), root)
	if err != nil || len(nodes) != 1 || nodes["link"].Supported() {
		t.Fatal("扫描跟随符号链接")
	}
	if err = CheckLocalSyncPath(root, "link/target", true); err == nil {
		t.Fatal("写入接受符号链接父目录")
	}
}
