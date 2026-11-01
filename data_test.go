package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"strings"
	"testing"
	"time"

	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"github.com/Sanjeever/termquay/internal/store"
)

func testAppStore(t *testing.T) *AppService {
	t.Helper()
	key := make([]byte, 32)
	rand.Read(key)
	s, err := store.Open(t.TempDir(), key)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	app := NewAppService()
	app.store = s
	return app
}

func TestCatalogCredentialsAndGroups(t *testing.T) {
	a := testAppStore(t)
	if err := a.SaveGroup(store.Group{ID: "parent", Name: "测试分组"}); err != nil {
		t.Fatal(err)
	}
	c := store.Connection{ID: "connection", Name: "测试连接", Protocol: "ssh", Host: "example.invalid", Port: 22, Username: "test", GroupID: "parent"}
	if err := a.SaveConnection(c, terminal.Request{Password: "test-credential-not-real"}); err != nil {
		t.Fatal(err)
	}
	catalog, err := a.GetCatalog()
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(catalog)
	if strings.Contains(string(raw), "test-credential-not-real") {
		t.Fatal("目录接口泄露凭据")
	}
	if err = a.DeleteGroup("parent"); err == nil {
		t.Fatal("删除仍被引用的分组")
	}
	c.Name = "新名称"
	if err = a.SaveConnection(c, terminal.Request{}); err != nil {
		t.Fatal(err)
	}
	r, _, err := a.savedRequest(c.ID)
	if err != nil || r.Password != "test-credential-not-real" {
		t.Fatal("编辑连接丢失已保存凭据")
	}
	if err = a.DeleteConnection(c.ID); err != nil {
		t.Fatal(err)
	}
	d, err := a.store.Read()
	if err != nil || len(d.Credentials) != 0 {
		t.Fatal("删除连接未清理无引用凭据")
	}
}

func TestRestorePreservesLocalSettingsAndRejectsStalePreview(t *testing.T) {
	a := testAppStore(t)
	if err := a.store.SetSecretSetting("webdav", "test-private-setting"); err != nil {
		t.Fatal(err)
	}
	before, err := a.store.Read()
	if err != nil {
		t.Fatal(err)
	}
	a.preview = &pendingRestore{id: "preview", data: store.Data{Groups: []store.Group{{ID: "new", Name: "恢复分组"}}}, base: before, expires: time.Now().Add(time.Minute)}
	if err = a.ConfirmRestore("other"); err == nil {
		t.Fatal("确认了其他预览")
	}
	if err = a.ConfirmRestore("preview"); err != nil {
		t.Fatal(err)
	}
	setting, err := a.store.SecretSetting("webdav")
	if err != nil || setting != "test-private-setting" {
		t.Fatal("恢复覆盖本机设置")
	}
	stored, err := a.store.Setting("webdav")
	if err != nil || strings.Contains(stored, "test-private-setting") {
		t.Fatal("秘密设置未加密")
	}
	a.preview = &pendingRestore{id: "preview2", data: before, base: before, expires: time.Now().Add(time.Minute)}
	if err = a.ConfirmRestore("preview2"); err == nil {
		t.Fatal("覆盖预览后变化的本机数据")
	}
}

func TestRDPDomainPersistsIntoLaunch(t *testing.T) {
	a := testAppStore(t)
	c := store.Connection{ID: "rdp", Name: "测试桌面", Protocol: "rdp", Host: "example.invalid", Port: 3389, Username: "test", Domain: "EXAMPLE"}
	if err := a.SaveConnection(c, terminal.Request{Password: "test-only"}); err != nil {
		t.Fatal(err)
	}
	launch, err := a.OpenSavedRDP(c.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer a.rdp.Close()
	if launch.Domain != "EXAMPLE" || launch.Username != "test" || launch.Password != "test-only" {
		t.Fatal("RDP 启动参数丢失域或凭据")
	}
	if _, err = a.OpenSavedTerminal(context.Background(), c.ID); err == nil {
		t.Fatal("允许以 SSH 打开 RDP 连接")
	}
}
