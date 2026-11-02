package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestWorkspaceLayoutMetadataAndValidation(t *testing.T) {
	a := testAppStore(t)
	layout := WorkspaceLayout{Version: 1, Active: "view", Entries: []WorkspaceLayoutEntry{{ID: "view", ConnectionID: "missing-kept-for-review", Name: "临时名称", Target: WorkspaceTarget{Name: "配置", Protocol: "ssh", Host: "example.invalid", Port: 22, Username: "test"}, SSH: &SSHLayout{Tabs: []WorkspaceTabLayout{{Kind: "terminal", Pane: 0}, {Kind: "file", Path: "/etc/test", Pane: 1}}, Selected: [2]int{0, 1}, Split: true, Ratio: 50, FilesWidth: 248}}}}
	if err := a.SaveWorkspaceLayout(layout); err != nil {
		t.Fatal(err)
	}
	got, err := a.GetWorkspaceLayout()
	if err != nil || got.Entries[0].Name != "临时名称" || got.Entries[0].ConnectionID != "missing-kept-for-review" {
		t.Fatal("布局或失效配置入口丢失")
	}
	encoded, _ := json.Marshal(got)
	for _, field := range []string{"password", "credential_id", "private_key", "grant", "content"} {
		if strings.Contains(string(encoded), field) {
			t.Fatal("布局包含禁止字段")
		}
	}
	layout.Entries[0].SSH.Tabs[0].Path = "old-pty"
	if err = a.SaveWorkspaceLayout(layout); err == nil {
		t.Fatal("保存 PTY 标识")
	}
	if err = a.store.SetSetting("workspace_layout", `{"version":2,"active":"","entries":[]}`); err != nil {
		t.Fatal(err)
	}
	if _, err = a.GetWorkspaceLayout(); err == nil {
		t.Fatal("接受未来布局版本")
	}
	layout.Entries[0].SSH.Tabs[0].Path = ""
	if err = a.SaveWorkspaceLayout(layout); err == nil {
		t.Fatal("覆盖未来版本布局")
	}
}
