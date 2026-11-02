package main

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"github.com/Sanjeever/termquay/internal/store"
)

func TestSSHImportPrecedenceJumpAndLocalKeyPath(t *testing.T) {
	a := testAppStore(t)
	keyPath := filepath.Join(t.TempDir(), "identity")
	p, err := a.PreviewSSHImport("Host gateway\n HostName gateway.invalid\n User tester\nHost target target\n HostName ::1\n Port 2222\n IdentityFile " + keyPath + "\n ProxyJump gateway\nHost *\n User fallback\n Port 22\n")
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Rows) != 2 || p.Rows[1].Connection.Host != "::1" || p.Rows[1].Connection.Port != 2222 || p.Rows[1].Connection.Username != "fallback" {
		t.Fatalf("优先级、别名去重或 IPv6 解析错误：%v", p.Rows)
	}
	if err = a.ConfirmSSHImport(p.ID, []SSHImportChoice{{ID: p.Rows[0].ID, Action: "new"}, {ID: p.Rows[1].ID, Action: "new"}}); err != nil {
		t.Fatal(err)
	}
	data, err := a.store.Read()
	if err != nil {
		t.Fatal(err)
	}
	byName := map[string]store.Connection{}
	for _, c := range data.Connections {
		byName[c.Name] = c
	}
	if byName["target"].JumpID != byName["gateway"].ID || byName["target"].AuthMethod != "private_key" || len(data.Credentials) != 0 {
		t.Fatal("跳板映射或本机私钥引用错误")
	}
	prefs, err := a.store.ConnectionPreferences()
	if err != nil || prefs[byName["target"].ID].PrivateKeyPath != keyPath {
		t.Fatal("本机路径未与配置一起写入")
	}
	if err = a.ConfirmSSHImport(p.ID, nil); err == nil {
		t.Fatal("重复使用已提交预览")
	}
}

func TestSSHImportReplaceClearsCredentialsAndPreservesUnrelatedSettings(t *testing.T) {
	a := testAppStore(t)
	c, err := a.SaveConnection(store.Connection{Name: "existing", Protocol: "ssh", Host: "old.invalid", Port: 22, Username: "tester"}, terminal.Request{Password: "import-test-only"})
	if err != nil {
		t.Fatal(err)
	}
	if err = a.store.SetSetting("unrelated", "preserved"); err != nil {
		t.Fatal(err)
	}
	p, err := a.PreviewSSHImport("Host existing\n HostName new.invalid\n User tester\n IdentityAgent /test/agent\n")
	if err != nil || len(p.Rows) != 1 || p.Rows[0].Conflict != c.ID {
		t.Fatalf("冲突预览错误：%v", err)
	}
	if err = a.ConfirmSSHImport(p.ID, []SSHImportChoice{{ID: p.Rows[0].ID, Action: "replace"}}); err != nil {
		t.Fatal(err)
	}
	data, err := a.store.Read()
	if err != nil || len(data.Connections) != 1 || data.Connections[0].ID != c.ID || data.Connections[0].AuthMethod != "agent" || data.Connections[0].CredentialID != "" || len(data.Credentials) != 0 {
		t.Fatalf("替换未清理旧凭据或改变配置身份：%v", err)
	}
	if value, err := a.store.Setting("unrelated"); err != nil || value != "preserved" {
		t.Fatal("导入覆盖无关设置")
	}
}

func TestSSHImportRejectsStaleAndExpiredPreview(t *testing.T) {
	a := testAppStore(t)
	p, err := a.PreviewSSHImport("Host target\n HostName target.invalid\n")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.SaveConnection(store.Connection{Name: "new", Protocol: "ssh", Host: "new.invalid", Port: 22}, terminal.Request{}); err != nil {
		t.Fatal(err)
	}
	if err = a.ConfirmSSHImport(p.ID, []SSHImportChoice{{ID: p.Rows[0].ID, Action: "new"}}); err == nil {
		t.Fatal("接受目录变化前的预览")
	}
	p, err = a.PreviewSSHImport("Host target\n HostName target.invalid\n")
	if err != nil {
		t.Fatal(err)
	}
	a.importPreview.expires = time.Now().Add(-time.Second)
	if err = a.ConfirmSSHImport(p.ID, nil); err == nil {
		t.Fatal("接受过期预览")
	}
}

func TestSSHImportRejectsInvalidChoicesAndRollsBack(t *testing.T) {
	for _, kind := range []string{"unknown", "duplicate", "self-jump"} {
		t.Run(kind, func(t *testing.T) {
			a := testAppStore(t)
			text := "Host target\n HostName target.invalid\n"
			if kind == "self-jump" {
				text += " ProxyJump target\n"
			}
			text += "Host sibling\n HostName sibling.invalid\n"
			p, err := a.PreviewSSHImport(text)
			if err != nil {
				t.Fatal(err)
			}
			before, err := a.store.Read()
			if err != nil {
				t.Fatal(err)
			}
			preferences, err := a.store.Setting("connection_preferences")
			if err != nil {
				t.Fatal(err)
			}
			choices := []SSHImportChoice{{ID: p.Rows[0].ID, Action: "new"}}
			if kind == "unknown" {
				choices = append(choices, SSHImportChoice{ID: "not-in-preview", Action: "new"})
			}
			if kind == "duplicate" {
				choices = append(choices, choices[0])
			}
			if err = a.ConfirmSSHImport(p.ID, choices); err == nil {
				t.Fatal("接受无效导入选择")
			}
			after, err := a.store.Read()
			if err != nil {
				t.Fatal(err)
			}
			currentPreferences, err := a.store.Setting("connection_preferences")
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(before, after) || preferences != currentPreferences {
				t.Fatal("失败导入部分写入配置或偏好")
			}
		})
	}
}

func TestSSHImportIncludesStayWithinSelectedFiles(t *testing.T) {
	a := testAppStore(t)
	dir := t.TempDir()
	main := filepath.Join(dir, "config")
	child := filepath.Join(dir, "included config")
	if err := os.WriteFile(child, []byte("Host child\n HostName child.invalid\n"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, directive := range []string{`Include="included config"`, `Include = "included config"`, `Include ="included config"`} {
		if err := os.WriteFile(main, []byte(directive+"\nHost parent\n HostName parent.invalid\n"), 0600); err != nil {
			t.Fatal(err)
		}
		p, err := a.previewSSHImportFiles([]string{main, child})
		if err != nil || len(p.Rows) != 2 || p.Rows[0].Connection.Name != "child" {
			t.Fatalf("Include 等号或含空格路径展开错误：%v", err)
		}
		p, err = a.previewSSHImportFiles([]string{main})
		if err != nil || len(p.Rows) != 1 || len(p.Warnings) == 0 {
			t.Fatalf("读取未选择的 Include 文件或未报告：%v", err)
		}
	}
	if err := os.WriteFile(child, []byte("Include config\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := a.previewSSHImportFiles([]string{main, child}); err == nil {
		t.Fatal("接受 Include 循环")
	}
	if _, err := a.PreviewSSHImport("Host target\n IdentityFile \"unterminated\n"); err == nil {
		t.Fatal("未报告不完整引号")
	}
}

func TestSSHImportUnsupportedCommandsNeverExecuteOrBecomeDirect(t *testing.T) {
	a := testAppStore(t)
	marker := filepath.Join(t.TempDir(), "must-not-exist")
	p, err := a.PreviewSSHImport("Host blocked\n HostName target.invalid\n ProxyCommand sh -c 'touch " + marker + "'\nMatch exec 'touch " + marker + "'\n HostName forbidden.invalid\nHost allowed\n HostName allowed.invalid\n")
	if err != nil || len(p.Rows) != 2 || len(p.Rows[0].Warnings) == 0 || !strings.Contains(strings.Join(p.Warnings, ","), "Match") {
		t.Fatalf("未报告不支持的执行项：%v", err)
	}
	if err = a.ConfirmSSHImport(p.ID, []SSHImportChoice{{ID: p.Rows[0].ID, Action: "new"}}); err == nil {
		t.Fatal("ProxyCommand 配置降级成直连")
	}
	if _, err = os.Stat(marker); !os.IsNotExist(err) {
		t.Fatal("执行配置中的本机命令")
	}
}
