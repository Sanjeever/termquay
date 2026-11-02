package main

import (
	"strings"
	"testing"
	"time"
)

func TestDraftRecoveryEncryptedAndWorkspaceScoped(t *testing.T) {
	a := testAppStore(t)
	for _, id := range []string{"one", "two"} {
		if err := a.RegisterWorkspaceView(id); err != nil {
			t.Fatal(err)
		}
	}
	if err := a.SaveWorkspaceDrafts("one", []RecoveryDraftInput{{Path: "/test.txt", Content: "recovery-placeholder"}}); err == nil {
		t.Fatal("草稿恢复默认未关闭")
	}
	if err := a.SetDraftRecoveryEnabled(true); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"one", "two"} {
		if err := a.SaveWorkspaceDrafts(id, []RecoveryDraftInput{{Path: "/test.txt", Content: "recovery-placeholder"}}); err != nil {
			t.Fatal(err)
		}
	}
	raw, err := a.store.Setting("workspace_drafts")
	if err != nil || strings.Contains(raw, "recovery-placeholder") {
		t.Fatal("草稿正文未加密")
	}
	a.ReleaseWorkspaceView("one")
	if err = a.SaveWorkspaceDrafts("one", nil); err != nil {
		t.Fatal(err)
	}
	state, err := a.GetDraftRecoveryState()
	if err != nil || len(state.Drafts) != 1 || state.Drafts[0].Workspace != "two" {
		t.Fatal("清理一个工作区误删其他草稿")
	}
	if err = a.SetDraftRecoveryEnabled(false); err != nil {
		t.Fatal(err)
	}
	state, err = a.GetDraftRecoveryState()
	if err != nil || state.Enabled || len(state.Drafts) != 0 {
		t.Fatal("关闭恢复未清理正文")
	}
}
func TestDraftRecoveryLimitsExpiryAndFutureVersion(t *testing.T) {
	a := testAppStore(t)
	a.RegisterWorkspaceView("view")
	a.SetDraftRecoveryEnabled(true)
	if err := a.SaveWorkspaceDrafts("view", []RecoveryDraftInput{{Path: "/test", Content: strings.Repeat("x", maxRecoveryDocumentBytes+1)}}); err == nil {
		t.Fatal("接受过大草稿")
	}
	if err := a.writeRecoveryData(recoveryData{Version: 1, Enabled: true, Drafts: []RecoveryDraft{{Workspace: "view", Path: "/expired", Content: "test-placeholder", UpdatedAt: time.Now().Add(-recoveryRetention - time.Second)}}}); err != nil {
		t.Fatal(err)
	}
	state, err := a.GetDraftRecoveryState()
	if err != nil || len(state.Drafts) != 0 {
		t.Fatal("过期草稿未清理")
	}
	if err = a.store.SetSecretSetting("workspace_drafts", `{"version":2,"enabled":true,"drafts":[]}`); err != nil {
		t.Fatal(err)
	}
	if _, err = a.GetDraftRecoveryState(); err == nil {
		t.Fatal("接受未来草稿版本")
	}
}

func TestDraftRecoveryMergedBatchIsAtomic(t *testing.T) {
	a := testAppStore(t)
	for _, id := range []string{"one", "two"} {
		a.RegisterWorkspaceView(id)
	}
	if err := a.SetDraftRecoveryEnabled(true); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 2)
	for _, id := range []string{"one", "two"} {
		go func(id string) {
			done <- a.SaveWorkspaceDrafts(id, []RecoveryDraftInput{{Path: "/test", Content: "test-placeholder"}})
		}(id)
	}
	for range 2 {
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}
	state, err := a.GetDraftRecoveryState()
	if err != nil || len(state.Drafts) != 2 {
		t.Fatal("并发合并丢失其他工作区草稿")
	}
	err = a.SaveRecoveryDrafts([]WorkspaceDraftUpdate{{Workspace: "one", Documents: []RecoveryDraftInput{{Path: "/test", Content: "changed-placeholder"}}}, {Workspace: "two", Documents: []RecoveryDraftInput{{Path: "/test", Content: strings.Repeat("x", maxRecoveryDocumentBytes+1)}}}})
	if err == nil {
		t.Fatal("接受无效批次")
	}
	draft, err := a.ReadRecoveryDraft("one", "/test")
	if err != nil || draft.Content != "test-placeholder" {
		t.Fatal("失败批次部分覆盖草稿")
	}
}
