package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/text/encoding/unicode"
)

func TestSessionImportFormatsAndGroups(t *testing.T) {
	tests := []struct {
		source, name, text string
		groups             int
	}{
		{"Xshell", "中文.xsh", "[CONNECTION]\nProtocol=SSH\nHost=example.invalid\nPort=2222\n[CONNECTION:AUTHENTICATION]\nUserName=tester", 0},
		{"MobaXterm", "sessions.mxtsessions", "[Bookmarks_1]\nSubRep=生产\\数据库\nImgNum=41\n中文=#109#0%example.invalid%2222%tester%%-1%-1%%%%%0%0%0%%%-1%0%0%0%%1080#font", 2},
		{"FinalShell", "session.json", `{"name":"中文","type":100,"host":"example.invalid","port":2222,"user_name":"tester","proxy_id":""}`, 0},
		{"SecureCRT", "sessions.xml", `<?xml version="1.0" encoding="UTF-16"?><VanDyke version="3.0"><key name="Sessions"><key name="生产"><key name="中文"><string name="Hostname">example.invalid</string><string name="Username">tester</string><string name="Protocol Name">SSH2</string><dword name="[SSH2] Port">2222</dword></key></key></key></VanDyke>`, 1},
	}
	for _, test := range tests {
		t.Run(test.source, func(t *testing.T) {
			a := testAppStore(t)
			data := []byte(test.text)
			if test.source == "Xshell" || test.source == "SecureCRT" {
				var err error
				data, err = unicode.UTF16(unicode.LittleEndian, unicode.UseBOM).NewEncoder().Bytes(data)
				if err != nil {
					t.Fatal(err)
				}
			}
			filename := filepath.Join(t.TempDir(), test.name)
			if err := os.WriteFile(filename, data, 0600); err != nil {
				t.Fatal(err)
			}
			preview, err := a.previewSessionFiles(test.source, []string{filename}, "")
			if err != nil {
				t.Fatal(err)
			}
			if len(preview.Rows) != 1 {
				t.Fatalf("会话数量错误: %d", len(preview.Rows))
			}
			row := preview.Rows[0]
			if row.Connection.Name != "中文" || row.Connection.Host != "example.invalid" || row.Connection.Port != 2222 || row.Connection.Username != "tester" || len(row.Warnings) != 0 || len(row.GroupPath) != test.groups {
				t.Fatalf("会话映射错误: %+v", row)
			}
			if err := a.ConfirmSSHImport(preview.ID, []SSHImportChoice{{ID: row.ID, Action: "new"}}); err != nil {
				t.Fatal(err)
			}
			dataOut, err := a.store.Read()
			if err != nil {
				t.Fatal(err)
			}
			if len(dataOut.Connections) != 1 || len(dataOut.Groups) != test.groups || len(dataOut.Credentials) != 0 {
				t.Fatal("提交未保留分组或意外导入凭据")
			}
		})
	}
}

func TestSessionImportBlocksNetworkDowngradeAndSecrets(t *testing.T) {
	for _, source := range []string{"Xshell", "MobaXterm", "FinalShell", "SecureCRT"} {
		t.Run(source, func(t *testing.T) {
			text := ""
			name := ""
			switch source {
			case "Xshell":
				name = "proxy.xsh"
				text = "[CONNECTION]\nProtocol=SSH\nHost=example.invalid\nPort=22\nProxy=required\n"
			case "MobaXterm":
				name = "proxy.mxtsessions"
				text = "[Bookmarks]\nproxy=#109#0%example.invalid%22%tester%%0%0%%gateway.invalid%22%jump%0%0%0%%%-1%0%0%0#font"
			case "FinalShell":
				name = "proxy.json"
				text = `{"name":"proxy","type":100,"host":"example.invalid","port":22,"proxy_id":"required"}`
			case "SecureCRT":
				name = "proxy.xml"
				text = `<VanDyke><key name="Sessions"><key name="proxy"><string name="Hostname">example.invalid</string><string name="Protocol Name">SSH2</string><string name="Firewall Name">required</string><dword name="[SSH2] Port">22</dword></key></key></VanDyke>`
			}
			rows, err := parseSessionFile(source, name, []byte(text))
			if err != nil || len(rows) != 1 || len(rows[0].Warnings) == 0 {
				t.Fatalf("没有阻止网络路径丢失: %v %+v", err, rows)
			}
		})
	}
	a := testAppStore(t)
	name := filepath.Join(t.TempDir(), "secret.xsh")
	if err := os.WriteFile(name, []byte("not-ini-secret-placeholder"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := a.previewSessionFiles("Xshell", []string{name}, ""); err == nil || strings.Contains(err.Error(), "not-ini-secret-placeholder") {
		t.Fatal("格式错误披露配置内容")
	}
}
