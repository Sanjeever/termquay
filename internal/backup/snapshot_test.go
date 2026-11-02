package backup

import (
	"bytes"
	"crypto/rand"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/Sanjeever/termquay/internal/store"
)

func TestCrossDeviceRestore(t *testing.T) {
	keyA, keyB := make([]byte, 32), make([]byte, 32)
	rand.Read(keyA)
	rand.Read(keyB)
	dirA, dirB := t.TempDir(), t.TempDir()
	a, err := store.Open(dirA, keyA)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	b, err := store.Open(dirB, keyB)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	d := store.Data{Groups: []store.Group{{ID: "g", Name: "测试"}}, Connections: []store.Connection{{ID: "c", GroupID: "g", Name: "隔离连接", Protocol: "ssh", Host: "example.invalid", Port: 22, CredentialID: "p"}}, Credentials: []store.Credential{{ID: "p", Kind: "password", Secret: "test-secret-not-a-real-credential"}}}
	d.Connections = append(d.Connections, store.Connection{ID: "rdp", GroupID: "g", Name: "隔离桌面", Protocol: "rdp", Host: "desktop.invalid", Port: 3389, Username: "test", Domain: "EXAMPLE", CredentialID: "p"})
	if err = a.Replace(d); err != nil {
		t.Fatal(err)
	}
	data, err := a.Read()
	if err != nil {
		t.Fatal(err)
	}
	encrypted, err := Encrypt(data, "device-a", "test-recovery-passphrase")
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(encrypted, []byte(d.Credentials[0].Secret)) {
		t.Fatal("备份包含明文凭据")
	}
	snap, err := Decrypt(encrypted, "test-recovery-passphrase")
	if err != nil {
		t.Fatal(err)
	}
	if err = b.Replace(snap.Data); err != nil {
		t.Fatal(err)
	}
	restored, err := b.Read()
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(data, restored) {
		t.Fatal("跨设备恢复内容不一致")
	}
	for _, dir := range []string{dirA, dirB} {
		raw, err := os.ReadFile(filepath.Join(dir, "termquay.db"))
		if err != nil {
			t.Fatal(err)
		}
		if bytes.Contains(raw, []byte(d.Credentials[0].Secret)) {
			t.Fatal("SQLite 包含明文凭据")
		}
	}
	if _, err = Decrypt(encrypted, "incorrect"); err == nil {
		t.Fatal("接受错误密码")
	}
	corrupted := bytes.Clone(encrypted)
	corrupted[len(corrupted)-1] ^= 1
	if _, err = Decrypt(corrupted, "test-recovery-passphrase"); err == nil {
		t.Fatal("接受损坏快照")
	}
	snap.Data.Connections[0].GroupID = "missing"
	if err = b.Replace(snap.Data); err == nil {
		t.Fatal("接受悬空分组引用")
	}
	after, err := b.Read()
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(after, restored) {
		t.Fatal("失败恢复覆盖现有数据")
	}
}

func TestGroupCycles(t *testing.T) {
	d := store.Data{Groups: []store.Group{{ID: "a", Name: "A", ParentID: "b"}, {ID: "b", Name: "B", ParentID: "a"}}}
	if err := d.Validate(); err == nil {
		t.Fatal("接受循环分组")
	}
}
func TestAgentSnapshotVersion(t *testing.T) {
	d := store.Data{Connections: []store.Connection{{ID: "agent", Name: "Agent", Protocol: "ssh", Host: "example.invalid", Port: 22, Username: "test", AuthMethod: "agent", IdentityAgent: "test-agent-address"}}}
	encrypted, err := Encrypt(d, "device", "test-backup-password")
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := Decrypt(encrypted, "test-backup-password")
	if err != nil || snapshot.Version != 2 || snapshot.Data.Connections[0].AuthMethod != "agent" {
		t.Fatal("新认证字段快照兼容失败")
	}
}
