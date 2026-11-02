package store

import (
	"reflect"
	"testing"
)

func TestReplaceWithSettingsRollsBackBothOnWriteFailure(t *testing.T) {
	s, err := Open(t.TempDir(), make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	before := Data{Groups: []Group{}, Connections: []Connection{{ID: "old", Name: "原配置", Protocol: "ssh", Host: "old.invalid", Port: 22, CredentialID: "credential"}}, Credentials: []Credential{{ID: "credential", Kind: "password", Secret: "transaction-test-only"}}}
	if err = s.ReplaceWithSettings(before, map[string]string{"connection_preferences": "original"}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(`CREATE TRIGGER reject_preferences BEFORE UPDATE ON settings WHEN NEW.id = 'connection_preferences' BEGIN SELECT RAISE(ABORT, 'injected write failure'); END`); err != nil {
		t.Fatal(err)
	}
	replacement := Data{Connections: []Connection{{ID: "new", Name: "导入配置", Protocol: "ssh", Host: "new.invalid", Port: 22}}}
	if err = s.ReplaceWithSettings(replacement, map[string]string{"connection_preferences": "replacement"}); err == nil {
		t.Fatal("未暴露设置写入失败")
	}
	after, err := s.Read()
	if err != nil {
		t.Fatal(err)
	}
	preferences, err := s.Setting("connection_preferences")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, after) || preferences != "original" {
		t.Fatal("设置失败未回滚配置、凭据和偏好")
	}
}
