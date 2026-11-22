package app

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
	layout.Version = 9
	layout.Entries[0].SSH.SplitDirection = "rows"
	if err := a.SaveWorkspaceLayout(layout); err != nil {
		t.Fatal(err)
	}
	stacked, err := a.GetWorkspaceLayout()
	if err != nil || stacked.Entries[0].SSH.SplitDirection != "rows" {
		t.Fatal("split direction was not restored", err)
	}
	layout.Version = 8
	if err := layout.validate(); err == nil {
		t.Fatal("old layout version accepted split orientation")
	}
	layout.Version = 9
	layout.Entries[0].SSH.SplitDirection = "diagonal"
	if err := layout.validate(); err == nil {
		t.Fatal("invalid split direction accepted")
	}
	layout.Entries[0].SSH.SplitDirection = "rows"
	for _, field := range []string{"password", "credential_id", "private_key", "grant", "content"} {
		if strings.Contains(string(encoded), field) {
			t.Fatal("布局包含禁止字段")
		}
	}
	layout.Entries[0].SSH.Tabs[0].Path = "old-pty"
	if err = a.SaveWorkspaceLayout(layout); err == nil {
		t.Fatal("保存 PTY 标识")
	}
	if err = a.store.SetSetting("workspace_layout", `{"version":99,"active":"","entries":[]}`); err != nil {
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

func TestWorkspaceLayoutSplitColumns(t *testing.T) {
	a := testAppStore(t)
	ssh := &SSHLayout{
		Tabs: []WorkspaceTabLayout{
			{Kind: "file", Path: "/etc/test", Pane: 0},
			{Kind: "terminal", Pane: 1},
			{Kind: "terminal", Pane: 2},
		},
		Selected: [2]int{0, 1}, ActivePane: 2, Split: true, SplitDirection: "rows",
		SplitColumns: &SSHLayoutColumns{Mode: "bottom", Ratio: 55, Selected: []int{2}},
		Ratio:        45, FilesWidth: 248,
	}
	layout := WorkspaceLayout{Version: 10, Entries: []WorkspaceLayoutEntry{{
		ID: "view", Name: "Server", Target: WorkspaceTarget{
			Protocol: "ssh", Host: "example.invalid", Port: 22,
		}, SSH: ssh,
	}}}
	if err := a.SaveWorkspaceLayout(layout); err != nil {
		t.Fatal(err)
	}
	got, err := a.GetWorkspaceLayout()
	if err != nil {
		t.Fatal(err)
	}
	columns := got.Entries[0].SSH.SplitColumns
	if columns == nil || columns.Mode != "bottom" || columns.Ratio != 55 || columns.Selected[0] != 2 {
		t.Fatalf("split columns were not restored: %+v", columns)
	}
	layout.Version = 9
	if err := layout.validate(); err == nil {
		t.Fatal("old layout version accepted additional panes")
	}
	layout.Version = 10
	ssh.SplitColumns.Selected[0] = 1
	if err := layout.validate(); err == nil {
		t.Fatal("accepted a selected terminal from another pane")
	}
	ssh.SplitColumns.Mode = "grid"
	ssh.SplitColumns.Selected = []int{2, -1}
	if err := layout.validate(); err != nil {
		t.Fatal(err)
	}
}
