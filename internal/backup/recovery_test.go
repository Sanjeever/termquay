package backup

import (
	"archive/zip"
	"bytes"
	"io"
	"strings"
	"testing"
	"time"

	"filippo.io/age"
	"github.com/Sanjeever/termquay/internal/store"
)

func TestRecoverySnapshotPasswordOrKeyAndLegacy(t *testing.T) {
	key, err := age.GenerateX25519Identity()
	if err != nil {
		t.Fatal(err)
	}
	snapshot := Snapshot{DeviceID: "device", CreatedAt: time.Now().UTC(), Data: store.Data{}}
	encrypted, err := EncryptSnapshotWithRecovery(snapshot, "backup-test-password", key.Recipient().String())
	if err != nil {
		t.Fatal(err)
	}
	if !IsRecoverySnapshot(encrypted) || SnapshotExtension(encrypted) != ".tqbackup" || bytes.Contains(encrypted, []byte(key.String())) || bytes.Contains(encrypted, []byte("backup-test-password")) {
		t.Fatal("容器类型错误或泄露恢复秘密")
	}
	for _, secret := range []struct{ password, key string }{{password: "backup-test-password"}, {key: key.String()}} {
		result, err := DecryptWithRecovery(encrypted, secret.password, secret.key)
		if err != nil || result.DeviceID != "device" {
			t.Fatalf("双解锁失败: %v", err)
		}
	}
	wrong, _ := age.GenerateX25519Identity()
	if _, err := DecryptWithRecovery(encrypted, "", wrong.String()); err == nil {
		t.Fatal("错误恢复密钥解锁成功")
	}
	if _, err := Decrypt(encrypted, "wrong"); err == nil {
		t.Fatal("错误密码解锁成功")
	}
	legacy, err := EncryptSnapshot(snapshot, "legacy-test-password")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Decrypt(legacy, "legacy-test-password"); err != nil {
		t.Fatal("旧备份不可读", err)
	}
	if _, err := DecryptWithRecovery(legacy, "", key.String()); err == nil {
		t.Fatal("新密钥追溯解密了旧备份")
	}
	protected, err := EncryptSnapshotWithRecovery(snapshot, "", key.Recipient().String())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DecryptWithRecovery(protected, "", key.String()); err != nil {
		t.Fatal("恢复密钥无法解锁保护副本", err)
	}
}

func TestRecoverySnapshotRejectsCorruptionAndMixedEnvelopes(t *testing.T) {
	key, _ := age.GenerateX25519Identity()
	snapshot := Snapshot{DeviceID: "device", CreatedAt: time.Now().UTC(), Data: store.Data{}}
	first, err := EncryptSnapshotWithRecovery(snapshot, "first-test-password", key.Recipient().String())
	if err != nil {
		t.Fatal(err)
	}
	second, err := EncryptSnapshotWithRecovery(snapshot, "second-test-password", key.Recipient().String())
	if err != nil {
		t.Fatal(err)
	}
	container, err := zip.NewReader(bytes.NewReader(second), int64(len(second)))
	if err != nil {
		t.Fatal(err)
	}
	var other []byte
	for _, file := range container.File {
		if file.Name == "recovery.age" {
			reader, _ := file.Open()
			other, _ = io.ReadAll(reader)
			reader.Close()
		}
	}
	for _, change := range []string{"mix", "corrupt", "duplicate", "unknown", "version"} {
		t.Run(change, func(t *testing.T) {
			var output bytes.Buffer
			writer := zip.NewWriter(&output)
			container, err := zip.NewReader(bytes.NewReader(first), int64(len(first)))
			if err != nil {
				t.Fatal(err)
			}
			for _, file := range container.File {
				reader, _ := file.Open()
				data, _ := io.ReadAll(reader)
				reader.Close()
				if file.Name == "recovery.age" && change == "mix" {
					data = other
				}
				if file.Name == "snapshot.age" && change == "corrupt" {
					data[len(data)-1] ^= 1
				}
				if file.Name == "manifest.json" && change == "version" {
					data = []byte(strings.Replace(string(data), `"version":1`, `"version":99`, 1))
				}
				entry, err := writer.CreateHeader(&zip.FileHeader{Name: file.Name, Method: zip.Store})
				if err != nil {
					t.Fatal(err)
				}
				entry.Write(data)
			}
			if change == "duplicate" {
				writer.CreateHeader(&zip.FileHeader{Name: "manifest.json", Method: zip.Store})
			}
			if change == "unknown" {
				writer.CreateHeader(&zip.FileHeader{Name: "../outside", Method: zip.Store})
			}
			writer.Close()
			if _, err := DecryptWithRecovery(output.Bytes(), "", key.String()); err == nil {
				t.Fatal("损坏或混合封装仍可恢复")
			}
		})
	}
}
