package app

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"github.com/Sanjeever/termquay/internal/store"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPrivateKeySelectionAndAgentCredentials(t *testing.T) {
	a := testAppStore(t)
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	der, _ := x509.MarshalPKCS8PrivateKey(key)
	content := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
	name := filepath.Join(t.TempDir(), "test-key")
	if err := os.WriteFile(name, content, 0600); err != nil {
		t.Fatal(err)
	}
	selection, err := a.stagePrivateKey(name)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(selection)
	if strings.Contains(string(raw), "PRIVATE KEY") {
		t.Fatal("选择接口返回私钥")
	}
	c, err := a.SaveConnection(store.Connection{Name: "密钥", Protocol: "ssh", Host: "example.invalid", Port: 22, Username: "test", AuthMethod: "private_key"}, terminal.Request{PrivateKeyToken: selection.ID})
	if err != nil {
		t.Fatal(err)
	}
	a.ReleasePrivateKey(selection.ID)
	r, _, err := a.savedRequest(c.ID)
	if err != nil || r.PrivateKey != string(content) {
		t.Fatal("私钥文件未独立加密保存")
	}
	c.AuthMethod = "agent"
	if _, err = a.SaveConnection(c, terminal.Request{}); err != nil {
		t.Fatal(err)
	}
	d, err := a.store.Read()
	if err != nil || len(d.Credentials) != 0 || d.Connections[0].CredentialID != "" {
		t.Fatal("Agent 模式仍关联秘密")
	}
}
