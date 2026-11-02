package main

import (
	"fmt"
	"testing"

	"github.com/Sanjeever/termquay/internal/store"
)

func TestConnectionPreferencesBoundRecentAndPreserveLocalState(t *testing.T) {
	a := testAppStore(t)
	d := store.Data{}
	for i := range 55 {
		d.Connections = append(d.Connections, store.Connection{ID: fmt.Sprint(i), Name: "测试连接", Protocol: "ssh", Host: "example.invalid", Port: 22})
	}
	if err := a.store.Replace(d); err != nil {
		t.Fatal(err)
	}
	if err := a.SetConnectionPreference("0", true, "production"); err != nil {
		t.Fatal(err)
	}
	for _, c := range d.Connections {
		if err := a.RecordConnectionSuccess(c.ID); err != nil {
			t.Fatal(err)
		}
	}
	p, err := a.GetConnectionPreferences()
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, value := range p {
		if value.LastConnected != nil {
			count++
		}
	}
	if count != 50 || !p["0"].Favorite || p["0"].Environment != "production" {
		t.Fatal("最近连接限额或独立偏好丢失")
	}
	if err = a.ClearRecentConnections(); err != nil {
		t.Fatal(err)
	}
	p, err = a.GetConnectionPreferences()
	if err != nil || !p["0"].Favorite {
		t.Fatal("清除最近影响收藏")
	}
	for _, value := range p {
		if value.LastConnected != nil {
			t.Fatal("最近记录未清除")
		}
	}
	if err = a.DeleteConnection("0"); err != nil {
		t.Fatal(err)
	}
	p, err = a.GetConnectionPreferences()
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := p["0"]; exists {
		t.Fatal("保留失效连接引用")
	}
	if err = a.SetConnectionPreference("missing", true, ""); err == nil {
		t.Fatal("接受不存在连接")
	}
	if err = a.SetConnectionPreference("1", true, "unknown"); err == nil {
		t.Fatal("接受无效环境")
	}
}

func TestRDPResolutionPreference(t *testing.T) {
	a := testAppStore(t)
	if err := a.store.Replace(store.Data{Connections: []store.Connection{{ID: "rdp", Name: "桌面", Protocol: "rdp", Host: "example.invalid", Port: 3389}}}); err != nil {
		t.Fatal(err)
	}
	if err := a.SetRDPResolution("rdp", "1920x1080"); err != nil {
		t.Fatal(err)
	}
	p, err := a.GetConnectionPreferences()
	if err != nil || p["rdp"].RDPResolution != "1920x1080" {
		t.Fatal("分辨率未持久保存")
	}
	if err = a.SetConnectionPreference("rdp", true, "production"); err != nil {
		t.Fatal(err)
	}
	p, err = a.GetConnectionPreferences()
	if err != nil || p["rdp"].RDPResolution != "1920x1080" {
		t.Fatal("其他偏好覆盖分辨率")
	}
	if err = a.SetRDPResolution("rdp", "99999x99999"); err == nil {
		t.Fatal("接受无效分辨率")
	}
	if err = a.SetRDPResolution("missing", "dynamic"); err == nil {
		t.Fatal("接受不存在连接")
	}
}

func TestDirectoryBookmarksStayWithConnection(t *testing.T) {
	a := testAppStore(t)
	if err := a.store.Replace(store.Data{Connections: []store.Connection{{ID: "one", Name: "一", Protocol: "ssh", Host: "example.invalid", Port: 22}, {ID: "two", Name: "二", Protocol: "ssh", Host: "example.invalid", Port: 22}}}); err != nil {
		t.Fatal(err)
	}
	if err := a.SetDirectoryBookmarks("one", []string{"/etc", "/tmp"}); err != nil {
		t.Fatal(err)
	}
	values, err := a.GetDirectoryBookmarks("one")
	if err != nil || len(values) != 2 {
		t.Fatal("书签未保存")
	}
	values, err = a.GetDirectoryBookmarks("two")
	if err != nil || len(values) != 0 {
		t.Fatal("书签串到其他连接")
	}
	for _, values := range [][]string{{"relative"}, {"/tmp/.."}, {"/tmp", "/tmp"}, make([]string, 33)} {
		if err = a.SetDirectoryBookmarks("one", values); err == nil {
			t.Fatal("接受无效书签")
		}
	}
}
