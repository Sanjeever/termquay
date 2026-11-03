package app

import (
	"testing"

	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"github.com/Sanjeever/termquay/internal/store"
)

func TestSharedCredentialUpdateAndIndependentEdit(t *testing.T) {
	a := testAppStore(t)
	first, err := a.SaveConnection(store.Connection{ID: "one", Name: "一", Protocol: "ssh", Host: "one.invalid", Port: 22, Username: "test"}, terminal.Request{Password: "local-placeholder"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := a.SaveConnection(store.Connection{ID: "two", Name: "二", Protocol: "ssh", Host: "two.invalid", Port: 22, Username: "test"}, terminal.Request{Password: "local-placeholder-two"})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.AssignCredential([]string{second.ID}, first.CredentialID); err != nil {
		t.Fatal(err)
	}
	if err := a.UpdateCredential(first.CredentialID, terminal.Request{Password: "updated-placeholder"}, []string{first.ID}); err == nil {
		t.Fatal("未拒绝过期引用列表")
	}
	if err := a.UpdateCredential(first.CredentialID, terminal.Request{Password: "updated-placeholder"}, []string{first.ID, second.ID}); err != nil {
		t.Fatal(err)
	}
	second, err = a.SaveConnection(second, terminal.Request{Password: "independent-placeholder"})
	if err != nil {
		t.Fatal(err)
	}
	if second.CredentialID == first.CredentialID {
		t.Fatal("单连接编辑改写了共享凭据")
	}
	password, err := a.GetConnectionPassword(first.ID)
	if err != nil || password != "updated-placeholder" {
		t.Fatal("共享凭据被单连接编辑覆盖", err)
	}
}
