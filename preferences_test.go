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
