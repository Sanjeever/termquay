package backup

import (
	"archive/zip"
	"bytes"
	"encoding/json"

	"io"
	"strings"

	"filippo.io/age"
	appmessage "github.com/Sanjeever/termquay/internal/message"
)

type recoveryManifest struct {
	Version   int    `json:"version"`
	Recipient string `json:"recipient"`
	Password  bool   `json:"password"`
}

func IsRecoverySnapshot(data []byte) bool { return bytes.HasPrefix(data, []byte("PK\x03\x04")) }

func SnapshotExtension(data []byte) string {
	if IsRecoverySnapshot(data) {
		return ".tqbackup"
	}
	return ".json.age"
}

func RecoveryRecipient(secret string) (string, error) {
	identity, err := parseRecoveryKey(secret)
	if err != nil {
		return "", err
	}
	return identity.Recipient().String(), nil
}

func parseRecoveryKey(secret string) (*age.X25519Identity, error) {
	if len(secret) > 4096 {
		return nil, appmessage.New("backend:recoveryKeyExceedsTheLengthLimit", "恢复密钥超过长度限制")
	}
	identities, err := age.ParseIdentities(strings.NewReader(secret))
	if err != nil || len(identities) != 1 {
		return nil, appmessage.New("backend:invalidRecoveryKeyFormat", "恢复密钥格式无效")
	}
	identity, ok := identities[0].(*age.X25519Identity)
	if !ok {
		return nil, appmessage.New("backend:unsupportedRecoveryKeyType", "恢复密钥类型不受支持")
	}
	return identity, nil
}

func encryptAge(plain []byte, recipient age.Recipient) ([]byte, error) {
	var output bytes.Buffer
	writer, err := age.Encrypt(&output, recipient)
	if err != nil {
		return nil, err
	}
	if _, err := writer.Write(plain); err != nil {
		return nil, err
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

func decryptAge(encrypted []byte, identity age.Identity, limit int) ([]byte, error) {
	reader, err := age.Decrypt(bytes.NewReader(encrypted), identity)
	if err != nil {
		return nil, appmessage.New("backend:unlockInformationDoesNotMatchOrCiphertextIs", "解锁信息不匹配或密文损坏")
	}
	plain, err := io.ReadAll(io.LimitReader(reader, int64(limit)+1))
	if err != nil {
		clear(plain)
		return nil, appmessage.New("backend:ciphertextIntegrityVerificationFailed", "密文完整性验证失败")
	}
	if len(plain) > limit {
		clear(plain)
		return nil, appmessage.New("backend:decryptedBodyExceedsSizeLimit", "解密正文超过大小限制")
	}
	return plain, nil
}

func encryptRecoverySnapshot(plain []byte, password, public string) ([]byte, error) {
	recipient, err := age.ParseX25519Recipient(public)
	if err != nil {
		return nil, appmessage.New("backend:invalidRecoveryPublicKeyFormat", "恢复公钥格式无效")
	}
	identity, err := age.GenerateX25519Identity()
	if err != nil {
		return nil, err
	}
	secret := []byte(identity.String())
	defer clear(secret)
	payload, err := encryptAge(plain, identity.Recipient())
	if err != nil {
		return nil, err
	}
	recovery, err := encryptAge(secret, recipient)
	if err != nil {
		return nil, err
	}
	manifest, err := json.Marshal(recoveryManifest{Version: 1, Recipient: public, Password: password != ""})
	if err != nil {
		return nil, err
	}
	files := map[string][]byte{"manifest.json": manifest, "snapshot.age": payload, "recovery.age": recovery}
	if password != "" {
		recipient, err := age.NewScryptRecipient(password)
		if err != nil {
			return nil, err
		}
		recipient.SetWorkFactor(18)
		wrapped, err := encryptAge(secret, recipient)
		if err != nil {
			return nil, err
		}
		files["password.age"] = wrapped
	}
	var result bytes.Buffer
	container := zip.NewWriter(&result)
	for _, name := range []string{"manifest.json", "snapshot.age", "recovery.age", "password.age"} {
		data, ok := files[name]
		if !ok {
			continue
		}
		writer, err := container.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Store})
		if err != nil {
			return nil, err
		}
		if _, err := writer.Write(data); err != nil {
			return nil, err
		}
	}
	if err := container.Close(); err != nil {
		return nil, err
	}
	if result.Len() > MaxSnapshot+(1<<20) {
		return nil, appmessage.New("backend:encryptedSnapshotExceedsSizeLimit", "加密快照超过大小限制")
	}
	return result.Bytes(), nil
}

func decryptRecoverySnapshot(data []byte, password, recovery string) ([]byte, error) {
	container, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, appmessage.New("backend:backupContainerCorrupted", "备份容器损坏")
	}
	if len(container.File) < 3 || len(container.File) > 4 {
		return nil, appmessage.New("backend:invalidBackupContainerEntry", "备份容器条目无效")
	}
	files := map[string][]byte{}
	for _, file := range container.File {
		limit := 64 << 10
		switch file.Name {
		case "manifest.json":
			limit = 1024
		case "snapshot.age":
			limit = MaxSnapshot + (1 << 20)
		case "password.age", "recovery.age":
		default:
			return nil, appmessage.New("backend:backupContainerContainsAnUnknownEntry", "备份容器包含未知条目")
		}
		if _, exists := files[file.Name]; exists || file.Method != zip.Store || file.UncompressedSize64 > uint64(limit) || file.CompressedSize64 != file.UncompressedSize64 {
			return nil, appmessage.New("backend:backupContainerEntriesDuplicatedCompressedOrOversized", "备份容器条目重复、压缩或超限")
		}
		reader, err := file.Open()
		if err != nil {
			return nil, err
		}
		body, err := io.ReadAll(io.LimitReader(reader, int64(limit)+1))
		reader.Close()
		if err != nil || len(body) > limit {
			return nil, appmessage.New("backend:backupContainerEntryCorruptedOrOversized", "备份容器条目损坏或超限")
		}
		files[file.Name] = body
	}
	var manifest recoveryManifest
	decoder := json.NewDecoder(bytes.NewReader(files["manifest.json"]))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil || manifest.Version != 1 {
		return nil, appmessage.New("backend:invalidBackupContainerVersionOrManifest", "备份容器版本或清单无效")
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return nil, appmessage.New("backend:backupManifestContainsExtraData", "备份清单包含额外数据")
	}
	if _, err := age.ParseX25519Recipient(manifest.Recipient); err != nil {
		return nil, appmessage.New("backend:invalidBackupRecoveryPublicKey", "备份恢复公钥无效")
	}
	if len(files["snapshot.age"]) == 0 || len(files["recovery.age"]) == 0 || manifest.Password != (len(files["password.age"]) > 0) {
		return nil, appmessage.New("backend:backupContainerMissingRequiredCiphertext", "备份容器缺少必要密文")
	}
	var secret []byte
	if recovery != "" {
		identity, err := parseRecoveryKey(recovery)
		if err != nil {
			return nil, err
		}
		if identity.Recipient().String() != manifest.Recipient {
			return nil, appmessage.New("backend:recoveryKeyDoesNotMatchThisBackup", "恢复密钥与此备份不匹配")
		}
		secret, err = decryptAge(files["recovery.age"], identity, 1024)
		if err != nil {
			return nil, err
		}
	} else {
		if !manifest.Password {
			return nil, appmessage.New("backend:thisSafetyCopyRequiresItsRecoveryKey", "这份保护副本需使用恢复密钥解锁")
		}
		identity, err := age.NewScryptIdentity(password)
		if err != nil {
			return nil, err
		}
		identity.SetMaxWorkFactor(20)
		secret, err = decryptAge(files["password.age"], identity, 1024)
		if err != nil {
			return nil, err
		}
	}
	defer clear(secret)
	identity, err := age.ParseX25519Identity(string(secret))
	if err != nil {
		return nil, appmessage.New("backend:invalidBackupContentKey", "备份内容密钥无效")
	}
	return decryptAge(files["snapshot.age"], identity, MaxSnapshot)
}
