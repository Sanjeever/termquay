package app

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Sanjeever/termquay/internal/files"
	"github.com/Sanjeever/termquay/internal/store"
)

func TestFileHistoryEncryptedDedupAndEviction(t *testing.T) {
	a := testAppStore(t)
	a.workspaces["workspace"] = &workspaceOwner{target: "test@example.invalid:22", identity: "test-fingerprint"}
	const remote = "/tmp/test-config"
	if history, err := a.GetFileHistory("workspace", remote); err != nil || !history.Enabled {
		t.Fatal("新文件未默认启用历史", err)
	}
	var first string
	for index := 0; index < 11; index++ {
		document := files.Document{Path: remote, Content: fmt.Sprintf("history-test-marker-%d", index), Revision: fmt.Sprint(index), Encoding: "UTF-8", LineEnding: "LF"}
		if err := a.recordFileVersion("workspace", document); err != nil {
			t.Fatal(err)
		}
		if err := a.recordFileVersion("workspace", document); err != nil {
			t.Fatal(err)
		}
		history, err := a.GetFileHistory("workspace", remote)
		if err != nil || len(history.Versions) != min(index+1, 10) {
			t.Fatal("历史未去重或未遵守单文件限额", err)
		}
		if index == 0 {
			first = history.Versions[0].ID
		}
	}
	if _, err := a.ReadFileVersion("workspace", remote, first); err == nil {
		t.Fatal("已淘汰版本仍可读取")
	}
	if raw, err := a.store.Setting("file_version:" + first); err != nil || raw != "" {
		t.Fatal("淘汰版本正文未删除", err)
	}
	history, err := a.GetFileHistory("workspace", remote)
	if err != nil {
		t.Fatal(err)
	}
	last := history.Versions[len(history.Versions)-1].ID
	document, err := a.ReadFileVersion("workspace", remote, last)
	if err != nil || document.Content != "history-test-marker-10" {
		t.Fatal("历史正文往返失败", err)
	}
	if raw, err := a.store.Setting("file_version:" + last); err != nil || strings.Contains(raw, "history-test-marker") {
		t.Fatal("历史正文未加密", err)
	}
	a.workspaces["workspace"].identity = "changed-fingerprint"
	if _, err := a.ReadFileVersion("workspace", remote, last); err == nil {
		t.Fatal("新身份读取了旧身份历史")
	}
	a.workspaces["workspace"].identity = "test-fingerprint"
	if err := a.ClearFileHistory("workspace", remote); err != nil {
		t.Fatal(err)
	}
	if raw, err := a.store.Setting("file_version:" + last); err != nil || raw != "" {
		t.Fatal("清除历史未删除正文", err)
	}
	if err := a.SetFileHistory("workspace", remote, false, "echo validate-test", ""); err != nil {
		t.Fatal(err)
	}
	for index := 0; index <= maxFileHistories; index++ {
		if err := a.recordFileVersion("workspace", files.Document{Path: fmt.Sprintf("/tmp/auto-%d", index), Content: "history-placeholder", Revision: "test"}); err != nil {
			t.Fatal(err)
		}
	}
	oldest, err := a.GetFileHistory("workspace", "/tmp/auto-0")
	if err != nil || len(oldest.Versions) != 0 {
		t.Fatal("超出文件限额未淘汰最旧历史", err)
	}
	if err := a.recordFileVersion("workspace", files.Document{Path: remote, Content: "disabled-placeholder", Revision: "test"}); err != nil {
		t.Fatal(err)
	}
	history, err = a.GetFileHistory("workspace", remote)
	if err != nil || history.Enabled || history.Validate != "echo validate-test" || len(history.Versions) != 0 {
		t.Fatal("自动淘汰改变了显式设置", err)
	}
	items, err := a.fileHistories()
	if err != nil || len(items) != maxFileHistories+1 {
		t.Fatal("自动历史未清理空索引", err)
	}
}

func TestFileHistoryFailurePreventsRemoteSave(t *testing.T) {
	a, _, remote := uploadTestClient(t)
	directory := t.TempDir()
	var err error
	a.store, err = store.Open(directory, make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { a.store.Close() })
	filename := filepath.Join(remote, "config")
	if err := os.WriteFile(filename, []byte("original-test-content"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := a.SetFileHistory("workspace", filename, true, "", ""); err != nil {
		t.Fatal(err)
	}
	document, err := a.ReadRemoteFile(t.Context(), "workspace", filename)
	if err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", filepath.Join(directory, "termquay.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TRIGGER reject_history BEFORE INSERT ON settings WHEN new.id LIKE 'file_version:%' BEGIN SELECT RAISE(ABORT, 'history-test-failure'); END`); err != nil {
		t.Fatal(err)
	}
	document.Content = "changed-test-content"
	if _, err := a.SaveRemoteFile(t.Context(), "workspace", document); err == nil || !strings.Contains(err.Error(), "history-test-failure") {
		t.Fatal("历史写入失败未阻止保存", err)
	}
	content, err := os.ReadFile(filename)
	if err != nil || string(content) != "original-test-content" {
		t.Fatal("历史写入失败改变了远端文件", err)
	}
	history, err := a.GetFileHistory("workspace", filename)
	if err != nil || len(history.Versions) != 0 {
		t.Fatal("失败事务保留了历史索引", err)
	}
}

func TestFileHistoryGlobalLimitAndChangedAction(t *testing.T) {
	a := testAppStore(t)
	a.workspaces["workspace"] = &workspaceOwner{target: "test@example.invalid:22", identity: "test-fingerprint"}
	var first string
	for index := 0; index < 9; index++ {
		remote := fmt.Sprintf("/tmp/config-%d", index)
		if err := a.SetFileHistory("workspace", remote, true, "echo validate-test", "echo reload-test"); err != nil {
			t.Fatal(err)
		}
		if err := a.recordFileVersion("workspace", files.Document{Path: remote, Content: strings.Repeat("x", files.MaxEditSize), Revision: "test"}); err != nil {
			t.Fatal(err)
		}
		history, _ := a.GetFileHistory("workspace", remote)
		if index == 0 {
			first = history.Versions[0].ID
		}
	}
	items, err := a.fileHistories()
	if err != nil {
		t.Fatal(err)
	}
	total := 0
	for _, item := range items {
		for _, version := range item.Versions {
			total += version.Size
		}
	}
	if total > fileHistoryLimit {
		t.Fatal("历史超出全局限额")
	}
	if raw, err := a.store.Setting("file_version:" + first); err != nil || raw != "" {
		t.Fatal("全局淘汰未清理最旧正文", err)
	}
	if _, err := a.RunFileAction(t.Context(), "workspace", "/tmp/config-0", "reload", "echo stale-test"); err == nil || !strings.Contains(err.Error(), "操作命令已变化") {
		t.Fatal("未在执行前拒绝旧命令", err)
	}
}
