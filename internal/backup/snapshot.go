package backup

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"time"

	"filippo.io/age"
	"github.com/Sanjeever/termquay/internal/store"
)

const MaxSnapshot = 16 << 20

type Snapshot struct {
	Version   int               `json:"version"`
	DeviceID  string            `json:"device_id"`
	CreatedAt time.Time         `json:"created_at"`
	Data      store.Data        `json:"data"`
	Settings  map[string]string `json:"settings,omitempty"`
}

func Encrypt(d store.Data, deviceID, password string) ([]byte, error) {
	return EncryptWithSettings(d, deviceID, password, nil)
}

func EncryptWithSettings(d store.Data, deviceID, password string, settings map[string]string) ([]byte, error) {
	if err := d.Validate(); err != nil {
		return nil, err
	}
	if deviceID == "" || password == "" {
		return nil, errors.New("设备标识和备份密码不能为空")
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
	if err := validateSettings(settings); err != nil {
		return nil, err
	}
	plain, err := json.Marshal(Snapshot{Version: version, DeviceID: deviceID, CreatedAt: time.Now().UTC(), Data: d, Settings: settings})
	if err != nil {
		return nil, err
	}
	if len(plain) > MaxSnapshot {
		return nil, errors.New("快照超过 16 MiB 限制")
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
	var snap Snapshot
	if len(encrypted) > MaxSnapshot+(1<<20) {
		return snap, errors.New("加密快照超过限制")
	}
	id, err := age.NewScryptIdentity(password)
	if err != nil {
		return snap, err
	}
	id.SetMaxWorkFactor(20)
	r, err := age.Decrypt(bytes.NewReader(encrypted), id)
	if err != nil {
		return snap, fmt.Errorf("快照解密失败: %w", err)
	}
	plain, err := io.ReadAll(io.LimitReader(r, MaxSnapshot+1))
	if err != nil {
		return snap, fmt.Errorf("快照完整性验证失败: %w", err)
	}
	if len(plain) > MaxSnapshot {
		return snap, errors.New("快照超过 16 MiB 限制")
	}
	decoder := json.NewDecoder(bytes.NewReader(plain))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&snap); err != nil {
		return snap, err
	}
	var extra any
	if err = decoder.Decode(&extra); err != io.EOF {
		return snap, errors.New("快照尾部包含额外数据")
	}
	if snap.Version < 1 || snap.Version > 5 {
		return snap, errors.New("不支持的快照版本")
	}
	if snap.Version < 5 && len(snap.Settings) > 0 {
		return snap, errors.New("旧快照不能包含可迁移设置")
	}
	if err := validateSettings(snap.Settings); err != nil {
		return snap, err
	}
	if snap.Version < 4 {
		for _, c := range snap.Data.Connections {
			if c.MFA || c.AuthMethod == "keyboard_interactive" {
				return snap, errors.New("旧快照不能包含交互认证字段")
			}
		}
	}
	if snap.Version < 3 {
		for _, c := range snap.Data.Connections {
			if c.JumpID != "" {
				return snap, errors.New("旧快照版本不能包含跳板字段")
			}
		}
	}
	if snap.Version == 1 {
		for _, c := range snap.Data.Connections {
			if c.AuthMethod != "" || c.IdentityAgent != "" {
				return snap, errors.New("v1 快照不能包含新认证字段")
			}
		}
	}
	if snap.DeviceID == "" || snap.CreatedAt.IsZero() {
		return snap, errors.New("快照元数据不完整")
	}
	return snap, snap.Data.Validate()
}

func validateSettings(settings map[string]string) error {
	for key, value := range settings {
		if (key != "snippets" && key != "appearance" && key != "shortcuts") || len(value) > 1<<20 || !json.Valid([]byte(value)) {
			return errors.New("快照设置类型、大小或 JSON 无效")
		}
	}
	return nil
}
