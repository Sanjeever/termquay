package app

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestUploadPreparationRequiresExplicitConfirmation(t *testing.T) {
	a := NewAppService(BuildInfo{Development: true}, nil)
	a.workspaces["workspace"] = &workspaceOwner{target: "user@example.test:22"}
	local := filepath.Join(t.TempDir(), "source.bin")
	if err := os.WriteFile(local, []byte("upload"), 0600); err != nil {
		t.Fatal(err)
	}
	paths := []string{local}
	preview, err := a.prepareUploads("workspace", "/target/./files", paths)
	if err != nil {
		t.Fatal(err)
	}
	paths[0] = "changed"
	if preview.Directory != "/target/files" || preview.Target != "user@example.test:22" || len(preview.Files) != 1 || preview.Files[0].Size != 6 || !preview.Files[0].Supported {
		t.Fatalf("上传预览不完整: %+v", preview)
	}
	if len(a.ListTransfers()) != 0 || a.uploadPreview.paths[0] != local {
		t.Fatal("预览提前创建任务或未固定本地路径")
	}
	if _, err := a.prepareUploads("workspace", "/other", []string{local}); err == nil {
		t.Fatal("待确认上传被替换")
	}
	if err := a.DiscardUpload("wrong-id"); err != nil || a.uploadPreview == nil {
		t.Fatal("错误标识清除了上传预览")
	}
	if _, err := a.ConfirmUpload(context.Background(), "wrong-id", "/target", false); err == nil {
		t.Fatal("错误标识提交了上传")
	}
	if err := a.DiscardUpload(preview.ID); err != nil || a.uploadPreview != nil || len(a.ListTransfers()) != 0 {
		t.Fatal("取消上传保留预览或创建任务")
	}
}

func TestUploadPreparationReportsUnsupportedFilesAndLimits(t *testing.T) {
	a := NewAppService(BuildInfo{Development: true}, nil)
	a.workspaces["workspace"] = &workspaceOwner{}
	directory := t.TempDir()
	file := filepath.Join(directory, "source")
	if err := os.WriteFile(file, nil, 0600); err != nil {
		t.Fatal(err)
	}
	preview, err := a.prepareUploads("workspace", "/target", []string{file, directory, file, filepath.Join(directory, "missing")})
	if err != nil {
		t.Fatal(err)
	}
	if !preview.Files[0].Supported || preview.Files[0].Size != 0 || !strings.Contains(preview.Files[1].Error, "目录同步") || !strings.Contains(preview.Files[2].Error, "同名") || preview.Files[3].Error == "" {
		t.Fatalf("文件类型或同名检查失效: %+v", preview.Files)
	}
	for _, file := range preview.Files[1:] {
		if file.Supported {
			t.Fatal("接受不支持的文件")
		}
	}
	if err := a.DiscardUpload(preview.ID); err != nil {
		t.Fatal(err)
	}
	for _, paths := range [][]string{nil, make([]string, 65)} {
		if _, err := a.prepareUploads("workspace", "/target", paths); err == nil {
			t.Fatal("接受无效文件数量")
		}
	}
	if _, err := a.prepareUploads("workspace", "relative", []string{file}); err == nil {
		t.Fatal("接受远端相对目录")
	}
	if _, err := a.prepareUploads("closed", "/target", []string{file}); err == nil {
		t.Fatal("接受已关闭工作区")
	}
}
