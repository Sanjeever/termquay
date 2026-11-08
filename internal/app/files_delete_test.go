package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/Sanjeever/termquay/internal/files"
)

func TestRecursiveDeletePreservesSymlinkTarget(t *testing.T) {
	a, client, remote := uploadTestClient(t)
	outside := filepath.Join(t.TempDir(), "保留.txt")
	if err := os.WriteFile(outside, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(remote, "目录")
	if err := os.MkdirAll(filepath.Join(root, "子目录"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "子目录", "文件.txt"), []byte("remove"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Dir(outside), filepath.Join(root, "外部链接")); err != nil {
		t.Fatal(err)
	}
	if err := a.DeleteRemotePath(context.Background(), "workspace", filepath.ToSlash(root)); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(root); !os.IsNotExist(err) {
		t.Fatal("非空目录未删除")
	}
	if _, err := os.Stat(outside); err != nil {
		t.Fatal("删除跟随了符号链接", err)
	}
	for _, invalid := range []string{"/", "/tmp/..", ".", "relative"} {
		if err := files.Delete(context.Background(), client, invalid, nil); err == nil {
			t.Fatalf("接受危险路径 %q", invalid)
		}
	}
}

func TestRecursiveDeleteCancellationAndChangedParent(t *testing.T) {
	_, client, remote := uploadTestClient(t)
	for _, changed := range []bool{false, true} {
		root := filepath.Join(remote, "tree")
		if err := os.MkdirAll(filepath.Join(root, "child"), 0700); err != nil {
			t.Fatal(err)
		}
		for _, name := range []string{"a", "b"} {
			if err := os.WriteFile(filepath.Join(root, "child", name), nil, 0600); err != nil {
				t.Fatal(err)
			}
		}
		ctx, cancel := context.WithCancel(context.Background())
		err := files.Delete(ctx, client, filepath.ToSlash(root), func(deleted int) {
			if deleted != 1 {
				return
			}
			if !changed {
				cancel()
				return
			}
			if err := os.Rename(filepath.Join(root, "child"), filepath.Join(root, "saved")); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(filepath.Join(root, "saved"), filepath.Join(root, "child")); err != nil {
				t.Fatal(err)
			}
		})
		cancel()
		if err == nil || !changed && !errors.Is(err, context.Canceled) {
			t.Fatalf("未阻止取消或目录变化: %v", err)
		}
		if err := os.RemoveAll(root); err != nil {
			t.Fatal(err)
		}
	}
}
