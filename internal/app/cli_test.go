package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/Sanjeever/termquay/internal/localapi"
	"github.com/Sanjeever/termquay/internal/store"
)

func TestCLIAuthorizationAndProjection(t *testing.T) {
	a := NewAppService(BuildInfo{Version: "1.3.0"}, nil)
	if err := a.UseSessionStorage(); err != nil {
		t.Fatal(err)
	}
	defer a.ServiceShutdown()
	r := localapi.Request{Operation: "connection.list"}
	if response := a.handleCLI(context.Background(), r); response.Error == nil || response.Error.Code != "disabled" {
		t.Fatalf("默认未拒绝：%+v", response)
	}
	if err := a.SaveCLIAccess(true); err != nil {
		t.Fatal(err)
	}
	if err := a.store.Replace(store.Data{Groups: []store.Group{}, Connections: []store.Connection{{ID: "one", Name: "主机", Protocol: "ssh", Host: "example.invalid", Port: 22, Username: "user", IdentityAgent: "private-agent-path", CredentialID: "secret-id"}}, Credentials: []store.Credential{{ID: "secret-id", Kind: "password", Secret: "test-secret"}}}); err != nil {
		t.Fatal(err)
	}
	response := a.handleCLI(context.Background(), r)
	if response.Error != nil {
		t.Fatal(response.Error)
	}
	for _, secret := range []string{"private-agent-path", "secret-id", "test-secret", "credential", "identity_agent"} {
		if strings.Contains(string(response.Data), secret) {
			t.Fatalf("泄露字段：%s", secret)
		}
	}
	var list []localapi.Connection
	if err := json.Unmarshal(response.Data, &list); err != nil || len(list) != 1 {
		t.Fatalf("%s %v", response.Data, err)
	}
	r.ProtocolFilter = "rdp"
	if string(a.handleCLI(context.Background(), r).Data) != "[]" {
		t.Fatal("协议筛选失效")
	}
	a.appLocked.Store(true)
	if response := a.handleCLI(context.Background(), r); response.Error == nil || response.Error.Code != "locked" {
		t.Fatal("锁定未拒绝")
	}
	if response := a.handleCLI(context.Background(), localapi.Request{Operation: "status"}); response.Error != nil || !strings.Contains(string(response.Data), `"locked":true`) {
		t.Fatal("锁定状态不可读")
	}
}
