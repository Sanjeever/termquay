package app

import (
	"testing"
	"time"

	"github.com/Sanjeever/termquay/internal/backup"
	"github.com/Sanjeever/termquay/internal/store"
)

func TestSelectedRestorePreservesExistingAndChecksSettings(t *testing.T) {
	a := testAppStore(t)
	data := store.Data{Groups: []store.Group{{ID: "group", Name: "测试"}}, Connections: []store.Connection{
		{ID: "jump", Name: "跳板", Protocol: "ssh", Host: "jump.invalid", Port: 22, Username: "test", GroupID: "group"},
		{ID: "target", Name: "目标", Protocol: "ssh", Host: "target.invalid", Port: 22, Username: "test", JumpID: "jump", GroupID: "group"},
	}}
	if err := a.store.Replace(data); err != nil {
		t.Fatal(err)
	}
	selected, err := selectSnapshotData(data, []string{"target"})
	if err != nil || len(selected.Connections) != 2 || len(selected.Groups) != 1 {
		t.Fatal("选择未包含跳板及分组", err)
	}
	snapshot := backup.Snapshot{Version: 5, DeviceID: "test", CreatedAt: time.Now(), Data: data, Settings: map[string]string{"snippets": `[{"id":"snippet","name":"测试","group":"","body":"echo test"}]`}}
	preview, err := a.prepareRestore(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.SaveSnippet(Snippet{Name: "预览后修改", Body: "echo changed"}); err != nil {
		t.Fatal(err)
	}
	if err := a.ConfirmRestoreSelection(preview.ID, []string{"target"}, false, true); err == nil {
		t.Fatal("恢复接受了过期设置基线")
	}
	preview, err = a.prepareRestore(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if err := a.ConfirmRestoreSelection(preview.ID, []string{"target"}, false, true); err != nil {
		t.Fatal(err)
	}
	actual, err := a.store.Read()
	if err != nil || len(actual.Connections) != 4 || len(actual.Groups) != 2 {
		t.Fatal("选择性导入覆盖了已有连接", err)
	}
	if err := actual.Validate(); err != nil {
		t.Fatal(err)
	}
	values, err := a.ListSnippets()
	if err != nil || len(values) != 1 || values[0].ID != "snippet" {
		t.Fatal("片段未随事务恢复", err)
	}
}
