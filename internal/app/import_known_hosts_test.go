package app

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"strings"
	"testing"

	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"github.com/Sanjeever/termquay/internal/store"
	gossh "golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

func TestKnownHostsImportHashMultipleKeysAndRevocation(t *testing.T) {
	a := testAppStore(t)
	_, err := a.SaveConnection(store.Connection{Name: "target", Host: "example.invalid", Port: 2222, Protocol: "ssh", Username: "tester"}, terminal.Request{})
	if err != nil {
		t.Fatal(err)
	}
	public, _, _ := ed25519.GenerateKey(rand.Reader)
	first, _ := gossh.NewPublicKey(public)
	private, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	second, _ := gossh.NewPublicKey(&private.PublicKey)
	public, _, _ = ed25519.GenerateKey(rand.Reader)
	revoked, _ := gossh.NewPublicKey(public)
	hashed := knownhosts.HashHostname("[example.invalid]:2222")
	text := knownhosts.Line([]string{hashed}, first) + "\n" + knownhosts.Line([]string{hashed}, second) + "\n" + knownhosts.Line([]string{hashed}, revoked) + "\n@revoked " + knownhosts.Line([]string{hashed}, revoked) + "\n@cert-authority " + knownhosts.Line([]string{"*.invalid"}, first) + "\n"
	p, err := a.PreviewKnownHostsImport(text)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Rows) != 1 || len(p.Rows[0].Keys) != 2 || p.Rows[0].Host != "example.invalid" || p.Rows[0].Port != 2222 {
		t.Fatalf("哈希匹配或撤销过滤错误: %+v", p.Rows)
	}
	if err := a.ConfirmKnownHostsImport(p.ID, []SSHImportChoice{{ID: p.Rows[0].ID, Action: "new"}}); err != nil {
		t.Fatal(err)
	}
	value, err := a.store.Setting("trust:ssh:example.invalid:2222")
	if err != nil {
		t.Fatal(err)
	}
	keys, err := terminal.DecodeHostTrust(value)
	if err != nil || len(keys) != 2 {
		t.Fatalf("未保存多种主机密钥: %v", err)
	}
	if err := a.ConfirmKnownHostsImport(p.ID, nil); err == nil {
		t.Fatal("预览被重复提交")
	}
}

func TestKnownHostsImportConflictAndRevokeInvalidatesPreview(t *testing.T) {
	a := testAppStore(t)
	public, _, _ := ed25519.GenerateKey(rand.Reader)
	key, _ := gossh.NewPublicKey(public)
	public, _, _ = ed25519.GenerateKey(rand.Reader)
	old, _ := gossh.NewPublicKey(public)
	if err := a.store.SetSetting("trust:ssh:example.invalid:22", gossh.FingerprintSHA256(old)); err != nil {
		t.Fatal(err)
	}
	p, err := a.PreviewKnownHostsImport(knownhosts.Line([]string{"example.invalid"}, key))
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Rows) != 1 || !p.Rows[0].Conflict {
		t.Fatal("未识别现有指纹冲突")
	}
	if err := a.ConfirmKnownHostsImport(p.ID, []SSHImportChoice{{ID: p.Rows[0].ID, Action: "new"}}); err == nil {
		t.Fatal("冲突被自动覆盖")
	}
	if err := a.RevokeTrust("trust:ssh:example.invalid:22"); err != nil {
		t.Fatal(err)
	}
	if err := a.ConfirmKnownHostsImport(p.ID, []SSHImportChoice{{ID: p.Rows[0].ID, Action: "replace"}}); err == nil {
		t.Fatal("撤销后旧预览恢复了信任")
	}
	if _, err := a.PreviewKnownHostsImport(strings.Repeat("x", (1<<20)+1)); err == nil {
		t.Fatal("接受超大 known_hosts")
	}
}
