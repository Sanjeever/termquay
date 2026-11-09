package backup

import (
	"bytes"
	"encoding/json"

	"io"
	"strings"
	"time"

	"filippo.io/age"
	appmessage "github.com/Sanjeever/termquay/internal/message"
	"github.com/Sanjeever/termquay/internal/store"
)

const MaxSnapshot = 16 << 20

type Snapshot struct {
	Version             int               `json:"version"`
	DeviceID            string            `json:"device_id"`
	CreatedAt           time.Time         `json:"created_at"`
	Data                store.Data        `json:"data"`
	Settings            map[string]string `json:"settings,omitempty"`
	DeviceName          string            `json:"device_name,omitempty"`
	CredentialsIncluded *bool             `json:"credentials_included,omitempty"`
}

func Encrypt(d store.Data, deviceID, password string) ([]byte, error) {
	return EncryptWithSettings(d, deviceID, password, nil)
}

func EncryptWithSettings(d store.Data, deviceID, password string, settings map[string]string) ([]byte, error) {
	return EncryptSnapshot(Snapshot{DeviceID: deviceID, CreatedAt: time.Now().UTC(), Data: d, Settings: settings}, password)
}

func EncryptSnapshot(snap Snapshot, password string) ([]byte, error) {
	return encryptSnapshot(snap, password, "")
}

func EncryptSnapshotWithRecovery(snap Snapshot, password, recipient string) ([]byte, error) {
	return encryptSnapshot(snap, password, recipient)
}

func encryptSnapshot(snap Snapshot, password, recovery string) ([]byte, error) {
	d, deviceID, settings := snap.Data, snap.DeviceID, snap.Settings
	if err := d.Validate(); err != nil {
		return nil, err
	}
	if deviceID == "" || password == "" && recovery == "" {
		return nil, appmessage.New("backend:deviceIdentifierAndBackupPasswordCannotBeEmpty", "设备标识和备份密码不能为空")
	}
	if err := validateMetadata(snap); err != nil {
		return nil, err
	}
	version := 1
	for _, c := range d.Connections {
		if c.AuthMethod != "" || c.IdentityAgent != "" {
			version = 2
		}
	}
	for _, c := range d.Connections {
		if c.JumpID != "" {
			version = 3
		}
	}
	for _, c := range d.Connections {
		if c.MFA || c.AuthMethod == "keyboard_interactive" {
			version = 4
		}
	}
	if len(settings) > 0 {
		version = 5
	}
	for _, c := range d.Connections {
		if c.Certificate != "" || c.ProxyAddress != "" {
			version = 6
		}
	}
	connections := map[string]store.Connection{}
	for _, c := range d.Connections {
		connections[c.ID] = c
	}
	for _, c := range d.Connections {
		if c.JumpID != "" && connections[c.JumpID].JumpID != "" {
			version = 7
		}
	}
	if snap.DeviceName != "" || snap.CredentialsIncluded != nil {
		version = 8
	}
	for key := range settings {
		if IsWorkflowSetting(key) {
			version = 9
		}
	}
	if err := validateSettings(settings); err != nil {
		return nil, err
	}
	snap.Version = version
	plain, err := json.Marshal(snap)
	if err != nil {
		return nil, err
	}
	if len(plain) > MaxSnapshot {
		return nil, appmessage.New("backend:snapshotExceeds16MiB", "快照超过 16 MiB 限制")
	}
	defer clear(plain)
	if recovery != "" {
		return encryptRecoverySnapshot(plain, password, recovery)
	}
	r, err := age.NewScryptRecipient(password)
	if err != nil {
		return nil, err
	}
	var encrypted bytes.Buffer
	w, err := age.Encrypt(&encrypted, r)
	if err != nil {
		return nil, err
	}
	if _, err = w.Write(plain); err != nil {
		return nil, err
	}
	if err = w.Close(); err != nil {
		return nil, err
	}
	return encrypted.Bytes(), nil
}

func Decrypt(encrypted []byte, password string) (Snapshot, error) {
	return DecryptWithRecovery(encrypted, password, "")
}

func DecryptWithRecovery(encrypted []byte, password, recovery string) (Snapshot, error) {
	var snap Snapshot
	if len(encrypted) > MaxSnapshot+(1<<20) {
		return snap, appmessage.New("backend:encryptedSnapshotExceedsTheLimit", "加密快照超过限制")
	}
	var plain []byte
	var err error
	if IsRecoverySnapshot(encrypted) {
		plain, err = decryptRecoverySnapshot(encrypted, password, recovery)
	} else {
		if recovery != "" {
			return snap, appmessage.New("backend:thisLegacyBackupHasNoRecoveryKeyUse", "这份旧格式备份未配置恢复密钥，请使用原备份密码")
		}
		id, e := age.NewScryptIdentity(password)
		if e != nil {
			return snap, e
		}
		id.SetMaxWorkFactor(20)
		plain, err = decryptAge(encrypted, id, MaxSnapshot)
	}
	if err != nil {
		return snap, appmessage.Errorf("backend:snapshotDecryptionOrIntegrityVerificationFailed", "快照解密或完整性校验失败：%w", err)
	}
	defer clear(plain)
	if len(plain) > MaxSnapshot {
		return snap, appmessage.New("backend:snapshotExceeds16MiB", "快照超过 16 MiB 限制")
	}
	decoder := json.NewDecoder(bytes.NewReader(plain))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&snap); err != nil {
		return snap, err
	}
	var extra any
	if err = decoder.Decode(&extra); err != io.EOF {
		return snap, appmessage.New("backend:snapshotHasTrailingData", "快照尾部包含额外数据")
	}
	if snap.Version < 1 || snap.Version > 9 {
		return snap, appmessage.New("backend:unsupportedSnapshotVersion", "不支持的快照版本")
	}
	if snap.Version < 8 && (snap.DeviceName != "" || snap.CredentialsIncluded != nil) {
		return snap, appmessage.New("backend:legacySnapshotsCannotContainDeviceNamesOrCredential", "旧快照不能包含设备名称或凭据携带标记")
	}
	for key := range snap.Settings {
		if snap.Version < 9 && IsWorkflowSetting(key) {
			return snap, appmessage.New("backend:legacySnapshotsCannotContainWorkflowSettings", "旧快照不能包含工作环境设置")
		}
	}
	if err := validateMetadata(snap); err != nil {
		return snap, err
	}
	if snap.Version < 5 && len(snap.Settings) > 0 {
		return snap, appmessage.New("backend:legacySnapshotsCannotContainPortableSettings", "旧快照不能包含可迁移设置")
	}
	if snap.Version < 6 {
		for _, c := range snap.Data.Connections {
			if c.Certificate != "" || c.ProxyAddress != "" {
				return snap, appmessage.New("backend:legacySnapshotsCannotContainUserCertificatesOrProxy", "旧快照不能包含用户证书或代理字段")
			}
		}
	}
	if snap.Version < 7 {
		connections := map[string]store.Connection{}
		for _, c := range snap.Data.Connections {
			connections[c.ID] = c
		}
		for _, c := range snap.Data.Connections {
			if c.JumpID != "" && connections[c.JumpID].JumpID != "" {
				return snap, appmessage.New("backend:legacySnapshotsCannotContainMultiHopConnections", "旧快照不能包含多跳连接")
			}
		}
	}
	if err := validateSettings(snap.Settings); err != nil {
		return snap, err
	}
	if snap.Version < 4 {
		for _, c := range snap.Data.Connections {
			if c.MFA || c.AuthMethod == "keyboard_interactive" {
				return snap, appmessage.New("backend:legacySnapshotsCannotContainInteractiveAuthenticationFields", "旧快照不能包含交互认证字段")
			}
		}
	}
	if snap.Version < 3 {
		for _, c := range snap.Data.Connections {
			if c.JumpID != "" {
				return snap, appmessage.New("backend:legacySnapshotVersionCannotContainJumpFields", "旧快照版本不能包含跳板字段")
			}
		}
	}
	if snap.Version == 1 {
		for _, c := range snap.Data.Connections {
			if c.AuthMethod != "" || c.IdentityAgent != "" {
				return snap, appmessage.New("backend:snapshotV1CannotContainNewAuthenticationFields", "v1 快照不能包含新认证字段")
			}
		}
	}
	if snap.DeviceID == "" || snap.CreatedAt.IsZero() {
		return snap, appmessage.New("backend:snapshotMetadataIncomplete", "快照元数据不完整")
	}
	return snap, snap.Data.Validate()
}

func validateMetadata(snap Snapshot) error {
	if snap.CreatedAt.IsZero() || len(snap.DeviceName) > 200 || strings.ContainsAny(snap.DeviceName, "\r\n\x00") {
		return appmessage.New("backend:invalidSnapshotCreationTimeOrDeviceName", "快照创建时间或设备名称无效")
	}
	if snap.CredentialsIncluded != nil && !*snap.CredentialsIncluded && len(snap.Data.Credentials) > 0 {
		return appmessage.New("backend:snapshotCredentialInclusionFlagDiffersFromItsContents", "快照凭据携带标记与内容不一致")
	}
	return nil
}

func validateSettings(settings map[string]string) error {
	for key, value := range settings {
		limit := 1 << 20
		if key == "workspace_sets" {
			limit = 2 << 20
		}
		if (key != "snippets" && key != "appearance" && key != "shortcuts" && !IsWorkflowSetting(key)) || len(value) > limit || !json.Valid([]byte(value)) {
			return appmessage.New("backend:invalidSnapshotSettingTypeSizeOrJSON", "快照设置类型、大小或 JSON 无效")
		}
	}
	return nil
}

func IsWorkflowSetting(key string) bool {
	switch key {
	case "command_tasks", "workspace_sets", "tunnel_presets", "sync_presets", "connection_preferences", "log_view_presets":
		return true
	}
	return false
}
