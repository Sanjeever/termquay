package app

import (
	"context"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"filippo.io/age"
	"github.com/Sanjeever/termquay/internal/backup"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"github.com/Sanjeever/termquay/internal/store"
	"golang.org/x/net/webdav"
)

func TestRecoveryKeyRestoreCreatesDecryptableProtectionWithoutPassword(t *testing.T) {
	a := testAppStore(t)
	key, err := age.GenerateX25519Identity()
	if err != nil {
		t.Fatal(err)
	}
	if err := a.SetBackupRecoveryRecipient(key.Recipient().String()); err != nil {
		t.Fatal(err)
	}
	connection, err := a.SaveConnection(store.Connection{Name: "snapshot", Protocol: "ssh", Host: "before.invalid", Port: 22, Username: "tester"}, terminal.Request{Password: "snapshot-test-only"})
	if err != nil {
		t.Fatal(err)
	}
	encrypted, device, err := a.createSnapshot("source-test-password", BackupSelection{Credentials: true})
	if err != nil {
		t.Fatal(err)
	}
	connection.Host = "changed.invalid"
	if _, err := a.SaveConnection(connection, terminal.Request{Password: "changed-test-only"}); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	server := httptest.NewServer(&webdav.Handler{FileSystem: webdav.Dir(root), LockSystem: webdav.NewMemLS()})
	defer server.Close()
	opts := backup.WebDAVOptions{URL: server.URL, Directory: "backups"}
	remote, err := opts.Append(context.Background(), device, encrypted)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(remote, ".tqbackup") {
		t.Fatal("新格式没有独立扩展名")
	}
	listed, err := opts.List(context.Background())
	if err != nil || len(listed) != 1 {
		t.Fatal("新格式未出现在备份列表", err)
	}
	a.automaticLoaded = true
	a.automaticConfig = &automaticBackupConfig{Options: opts, Paused: true}
	if err := a.store.SetSetting("backup_recovery_recipient", ""); err != nil {
		t.Fatal(err)
	}
	preview, err := a.PreviewSavedRestoreWithRecovery(context.Background(), remote, key.String())
	if err != nil {
		t.Fatal(err)
	}
	if a.preview.password != "" || a.preview.recoveryRecipient != key.Recipient().String() {
		t.Fatal("恢复保留了错误的解锁状态")
	}
	if err := a.ConfirmRestore(preview.ID); err != nil {
		t.Fatal(err)
	}
	current, err := a.store.Read()
	if err != nil || current.Connections[0].Host != "before.invalid" {
		t.Fatal("恢复未提交原快照", err)
	}
	files, err := filepath.Glob(filepath.Join(a.store.Directory(), "restore-backups", "*.tqbackup"))
	if err != nil || len(files) != 1 {
		t.Fatal("未生成恢复密钥保护副本", err)
	}
	data, err := os.ReadFile(files[0])
	if err != nil {
		t.Fatal(err)
	}
	protected, err := backup.DecryptWithRecovery(data, "", key.String())
	if err != nil || protected.Data.Connections[0].Host != "changed.invalid" || len(protected.Data.Credentials) != 1 {
		t.Fatal("保护副本无法独立恢复", err)
	}
}

func TestRecoveryKeyExportNeverOverwritesExistingKey(t *testing.T) {
	filename := filepath.Join(t.TempDir(), "recovery.agekey")
	first, err := age.GenerateX25519Identity()
	if err != nil {
		t.Fatal(err)
	}
	if err := writeRecoveryKey(filename, []byte(first.String())); err != nil {
		t.Fatal(err)
	}
	second, err := age.GenerateX25519Identity()
	if err != nil {
		t.Fatal(err)
	}
	if err := writeRecoveryKey(filename, []byte(second.String())); err == nil {
		t.Fatal("导出覆盖了历史恢复密钥")
	}
	data, err := os.ReadFile(filename)
	if err != nil {
		t.Fatal(err)
	}
	defer clear(data)
	if string(data) != first.String() {
		t.Fatal("旧恢复密钥被修改")
	}
}
