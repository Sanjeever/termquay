package app

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"encoding/xml"

	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	"github.com/Sanjeever/termquay/internal/store"
	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/text/encoding/charmap"
	"golang.org/x/text/encoding/unicode"
	"gopkg.in/ini.v1"
)

func (a *AppService) SelectSessionImport(source string, directory bool) (SSHImportPreview, error) {
	if !validSessionSource(source) {
		return SSHImportPreview{}, appmessage.New("backend:invalidImportSource", "导入来源无效")
	}
	dialog := application.Get().Dialog.OpenFile().SetTitle(fmt.Sprintf(nativeText("Select %s session configuration", "选择 %s 会话配置"), source))
	if directory {
		name, err := dialog.CanChooseFiles(false).CanChooseDirectories(true).PromptForSingleSelection()
		if err != nil {
			return SSHImportPreview{}, err
		}
		if name == "" {
			return SSHImportPreview{}, appmessage.New("backend:noConfigurationDirectorySelected", "未选择配置目录")
		}
		names := []string{}
		visited := 0
		err = filepath.WalkDir(name, func(filename string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			visited++
			if visited > 4096 {
				return appmessage.New("backend:configurationDirectoryExceeds4096EntriesSelectASmaller", "配置目录超过 4096 项，请选择更小范围")
			}
			if entry.Type()&os.ModeSymlink != 0 {
				return appmessage.New("backend:configurationDirectoryContainsSymbolicLinksSelectRegularFiles", "配置目录包含符号链接，请明确选择普通配置文件")
			}
			if !entry.IsDir() && sessionExtension(source, filename) {
				names = append(names, filename)
			}
			if len(names) > 512 {
				return appmessage.New("backend:configurationFileCountExceeds512", "配置文件超过 512 个")
			}
			return nil
		})
		if err != nil {
			return SSHImportPreview{}, err
		}
		return a.previewSessionFiles(source, names, name)
	}
	names, err := dialog.PromptForMultipleSelection()
	if err != nil {
		return SSHImportPreview{}, err
	}
	return a.previewSessionFiles(source, names, "")
}

func validSessionSource(source string) bool {
	return source == "Xshell" || source == "MobaXterm" || source == "FinalShell" || source == "SecureCRT"
}

func sessionExtension(source, name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	switch source {
	case "Xshell":
		return ext == ".xsh"
	case "FinalShell":
		return ext == ".json"
	case "SecureCRT":
		return ext == ".xml"
	case "MobaXterm":
		return ext == ".ini" || ext == ".mxtsessions" || ext == ".moba"
	}
	return false
}

func (a *AppService) previewSessionFiles(source string, names []string, root string) (SSHImportPreview, error) {
	if !validSessionSource(source) || len(names) == 0 || len(names) > 512 {
		return SSHImportPreview{}, appmessage.New("backend:selectFrom1To512SupportedConfigurationFiles", "请选择 1 至 512 个受支持配置文件")
	}
	rows := []SSHImportRow{}
	total := 0
	for _, name := range names {
		if !sessionExtension(source, name) {
			return SSHImportPreview{}, appmessage.New("backend:fileExtensionDoesNotMatchTheImportSource", "文件扩展名与导入来源不匹配")
		}
		info, err := os.Lstat(name)
		if err != nil {
			return SSHImportPreview{}, err
		}
		if !info.Mode().IsRegular() || info.Size() > 1<<20 {
			return SSHImportPreview{}, appmessage.New("backend:configurationMustBeARegularFileNoLarger", "配置须为不超过 1 MiB 的普通文件")
		}
		file, err := os.Open(name)
		if err != nil {
			return SSHImportPreview{}, err
		}
		data, err := io.ReadAll(io.LimitReader(file, (1<<20)+1))
		file.Close()
		total += len(data)
		if err != nil {
			return SSHImportPreview{}, err
		}
		if len(data) > 1<<20 || total > 8<<20 {
			return SSHImportPreview{}, appmessage.New("backend:configurationFileExceeds1MiBOrTotalSize", "配置文件超过 1 MiB 或合计超过 8 MiB")
		}
		parsed, err := parseSessionFile(source, filepath.Base(name), data)
		if err != nil {
			return SSHImportPreview{}, appmessage.Errorf("backend:invalidConfigurationFormat", "%s：配置格式无效（%s）", filepath.Base(name), source)
		}
		if root != "" {
			relative, err := filepath.Rel(root, filepath.Dir(name))
			if err != nil {
				return SSHImportPreview{}, err
			}
			if relative != "." {
				for i := range parsed {
					parsed[i].GroupPath = append(strings.Split(filepath.ToSlash(relative), "/"), parsed[i].GroupPath...)
				}
			}
		}
		rows = append(rows, parsed...)
		if len(rows) > 512 {
			return SSHImportPreview{}, appmessage.New("backend:importedSessionCountExceeds512", "导入会话超过 512 项")
		}
	}
	if len(rows) == 0 {
		return SSHImportPreview{}, appmessage.New("backend:noSupportedConnectionSessionsFound", "没有找到受支持的连接会话")
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return SSHImportPreview{}, err
	}
	data, err := a.store.Read()
	if err != nil {
		return SSHImportPreview{}, err
	}
	for i := range rows {
		row := &rows[i]
		row.ID = base64.RawURLEncoding.EncodeToString(randomBytes(16))
		if row.Connection.Host == "" || row.Connection.Port < 1 || row.Connection.Port > 65535 {
			appendImportNotices(&row.Warnings, &row.WarningMessages, appmessage.New("backend:invalidHostPort", "主机或端口无效"))
		}
		if row.Connection.Username == "" {
			appendImportNotices(&row.Notes, &row.NoteMessages, appmessage.New("backend:usernameBeforeConnecting", "连接前需填写用户名"))
		}
		if row.Connection.Protocol != "ssh" && row.Connection.Protocol != "rdp" {
			appendImportNotices(&row.Warnings, &row.WarningMessages, appmessage.New("backend:protocolUnsupported", "协议暂不支持"))
		}
		if len(row.GroupPath) > 32 {
			return SSHImportPreview{}, appmessage.New("backend:groupNestingExceeds32Levels", "分组超过 32 层")
		}
		for _, name := range row.GroupPath {
			if strings.TrimSpace(name) == "" || len(name) > 200 {
				return SSHImportPreview{}, appmessage.New("backend:invalidGroupName", "分组名称无效")
			}
		}
		for _, old := range data.Connections {
			if old.Name == row.Connection.Name {
				row.Conflict = old.ID
				break
			}
		}
	}
	p := SSHImportPreview{ID: base64.RawURLEncoding.EncodeToString(randomBytes(18)), Rows: rows, Warnings: []string{"保存的密码、私钥内容、自动登录命令及转发未迁移，连接前需重新配置认证。"}, WarningMessages: []*appmessage.Descriptor{appmessage.Describe(appmessage.New("backend:authenticationNotMigrated", "保存的密码、私钥内容、自动登录命令及转发未迁移，连接前需重新配置认证。"))}, base: data, expires: time.Now().Add(10 * time.Minute)}
	a.importPreview = &p
	return p, nil
}

func parseSessionFile(source, name string, data []byte) ([]SSHImportRow, error) {
	if bytes.HasPrefix(data, []byte{0xff, 0xfe}) || bytes.HasPrefix(data, []byte{0xfe, 0xff}) {
		var err error
		data, err = unicode.UTF16(unicode.LittleEndian, unicode.UseBOM).NewDecoder().Bytes(data)
		if err != nil {
			return nil, err
		}
	}
	data = bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf})
	if !utf8.Valid(data) {
		if source != "MobaXterm" {
			return nil, appmessage.New("backend:invalidConfigurationEncoding", "配置编码无效")
		}
		var err error
		data, err = charmap.Windows1252.NewDecoder().Bytes(data)
		if err != nil {
			return nil, err
		}
	}
	if source == "FinalShell" {
		return parseFinalShell(data)
	}
	if source == "SecureCRT" {
		return parseSecureCRT(data)
	}
	if source == "MobaXterm" && strings.EqualFold(filepath.Ext(name), ".moba") {
		data = append([]byte("[Bookmarks]\n"), data...)
	}
	config, err := ini.LoadSources(ini.LoadOptions{InsensitiveSections: true, IgnoreInlineComment: true, AllowShadows: true, KeyValueDelimiters: "="}, data)
	if err != nil {
		return nil, err
	}
	if source == "MobaXterm" {
		return parseMobaXterm(config)
	}
	connection, auth := config.Section("connection"), config.Section("connection:authentication")
	protocol := strings.ToLower(connection.Key("Protocol").String())
	if protocol == "ssh" || protocol == "ssh2" {
		protocol = "ssh"
	}
	row := SSHImportRow{Connection: store.Connection{Name: strings.TrimSuffix(name, filepath.Ext(name)), Host: connection.Key("Host").String(), Username: auth.Key("UserName").String(), Protocol: protocol}}
	row.Connection.Port, _ = strconv.Atoi(connection.Key("Port").String())
	if protocol == "ssh" {
		row.Connection.AuthMethod = "password"
	}
	for _, section := range config.Sections() {
		for _, key := range section.Keys() {
			if len(key.ValueWithShadows()) > 1 {
				return nil, appmessage.New("backend:duplicateConfigurationField", "配置字段重复")
			}
			field := strings.ToLower(key.Name())
			value := strings.TrimSpace(key.String())
			if (field == "proxy" || field == "proxyname" || field == "jumpservername" || field == "jumphost") && value != "" && value != "0" {
				appendImportNotices(&row.Warnings, &row.WarningMessages, appmessage.New("backend:proxyJumpNotMapped", "代理或跳板尚未映射，已阻止直连导入"))
			}
		}
	}
	return []SSHImportRow{row}, nil
}

func parseMobaXterm(config *ini.File) ([]SSHImportRow, error) {
	rows := []SSHImportRow{}
	for _, section := range config.Sections() {
		if section.Name() != "bookmarks" && !strings.HasPrefix(section.Name(), "bookmarks_") {
			continue
		}
		group := section.Key("SubRep").String()
		for _, key := range section.Keys() {
			if key.Name() == "SubRep" || key.Name() == "ImgNum" {
				continue
			}
			if len(key.ValueWithShadows()) > 1 {
				return nil, appmessage.New("backend:duplicateSessionName", "会话名称重复")
			}
			parts := strings.Split(key.String(), "#")
			if len(parts) < 3 {
				return nil, appmessage.New("backend:incompleteSessionFields", "会话字段不完整")
			}
			fields := strings.Split(parts[2], "%")
			if len(fields) < 4 {
				return nil, appmessage.New("backend:incompleteSessionAddress", "会话地址不完整")
			}
			protocol := ""
			if fields[0] == "0" {
				protocol = "ssh"
			}
			if fields[0] == "2" {
				protocol = "rdp"
			}
			row := SSHImportRow{Connection: store.Connection{Name: key.Name(), Host: fields[1], Username: fields[3], Protocol: protocol}}
			row.Connection.Port, _ = strconv.Atoi(fields[2])
			if row.Connection.Username == "<default>" {
				row.Connection.Username = ""
			}
			if group != "" {
				row.GroupPath = strings.Split(strings.ReplaceAll(group, "\\", "/"), "/")
			}
			if protocol == "ssh" {
				row.Connection.AuthMethod = "password"
				if len(fields) < 20 {
					appendImportNotices(&row.Warnings, &row.WarningMessages, appmessage.New("backend:sshFieldVersionUnknown", "SSH 字段版本无法识别，不能核对网络路径"))
				} else if fields[8] != "" || (fields[19] != "" && fields[19] != "0") {
					appendImportNotices(&row.Warnings, &row.WarningMessages, appmessage.New("backend:proxyJumpNotMapped", "代理或跳板尚未映射，已阻止直连导入"))
				}
			}
			if protocol == "rdp" {
				appendImportNotices(&row.Warnings, &row.WarningMessages, appmessage.New("backend:rdpGatewayUnverified", "RDP 网关字段尚未验证，请手工创建连接"))
			}
			rows = append(rows, row)
		}
	}
	return rows, nil
}

func parseFinalShell(data []byte) ([]SSHImportRow, error) {
	var value struct {
		Name      string          `json:"name"`
		Host      string          `json:"host"`
		Port      int             `json:"port"`
		User      string          `json:"user_name"`
		Type      int             `json:"type"`
		Proxy     json.RawMessage `json:"proxy_id"`
		ProxyType json.RawMessage `json:"proxy_type"`
	}
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, err
	}
	if value.Host == "" {
		return nil, nil
	}
	row := SSHImportRow{Connection: store.Connection{Name: value.Name, Host: value.Host, Port: value.Port, Username: value.User, Protocol: "ssh", AuthMethod: "password"}}
	if value.Type != 100 {
		appendImportNotices(&row.Warnings, &row.WarningMessages, appmessage.New("backend:finalShellTypeUnsupported", "FinalShell 会话类型暂不支持"))
	}
	for _, raw := range []json.RawMessage{value.Proxy, value.ProxyType} {
		if len(raw) > 0 && string(raw) != "null" && string(raw) != "0" && string(raw) != "\"\"" && string(raw) != "-1" {
			appendImportNotices(&row.Warnings, &row.WarningMessages, appmessage.New("backend:proxyNotMapped", "代理尚未映射，已阻止直连导入"))
		}
	}
	return []SSHImportRow{row}, nil
}

type secureCRTNode struct {
	XMLName  xml.Name
	Name     string          `xml:"name,attr"`
	Text     string          `xml:",chardata"`
	Children []secureCRTNode `xml:",any"`
}

func parseSecureCRT(data []byte) ([]SSHImportRow, error) {
	var root secureCRTNode
	decoder := xml.NewDecoder(bytes.NewReader(data))
	decoder.CharsetReader = func(charset string, input io.Reader) (io.Reader, error) {
		if strings.EqualFold(charset, "UTF-16") || strings.EqualFold(charset, "UTF-8") {
			return input, nil
		}
		return nil, appmessage.New("backend:xMLCharacterEncodingIsNotSupportedYet", "XML 字符编码暂不支持")
	}
	if err := decoder.Decode(&root); err != nil {
		return nil, err
	}
	if root.XMLName.Local != "VanDyke" {
		return nil, appmessage.New("backend:notASecureCRTXMLFile", "不是 SecureCRT XML")
	}
	rows := []SSHImportRow{}
	var visit func(secureCRTNode, []string, bool, int) error
	visit = func(node secureCRTNode, group []string, inSessions bool, depth int) error {
		if depth > 64 || len(rows) > 512 {
			return appmessage.New("backend:xMLExceedsDepthOrSessionCountLimits", "XML 超过深度或会话数量限制")
		}
		if node.Name == "Sessions" {
			inSessions = true
			group = nil
		}
		fields := map[string]string{}
		for _, child := range node.Children {
			if child.XMLName.Local != "key" {
				fields[child.Name] = strings.TrimSpace(child.Text)
			}
		}
		if inSessions && fields["Hostname"] != "" && node.Name != "Default" {
			protocol := strings.ToLower(fields["Protocol Name"])
			if protocol == "ssh2" {
				protocol = "ssh"
			}
			row := SSHImportRow{Connection: store.Connection{Name: node.Name, Host: fields["Hostname"], Username: fields["Username"], Protocol: protocol}, GroupPath: append([]string(nil), group...)}
			port := fields["[SSH2] Port"]
			if protocol == "rdp" {
				port = fields["[RDP] Port"]
			}
			row.Connection.Port, _ = strconv.Atoi(port)
			if protocol == "ssh" {
				row.Connection.AuthMethod = "password"
			}
			if firewall := fields["Firewall Name"]; firewall != "" && firewall != "None" {
				appendImportNotices(&row.Warnings, &row.WarningMessages, appmessage.New("backend:firewallRouteNotMapped", "防火墙代理或跳板尚未映射，已阻止直连导入"))
			}
			rows = append(rows, row)
			return nil
		}
		if inSessions && node.Name != "Sessions" && node.XMLName.Local == "key" {
			group = append(append([]string(nil), group...), node.Name)
		}
		for _, child := range node.Children {
			if child.XMLName.Local == "key" {
				if err := visit(child, group, inSessions, depth+1); err != nil {
					return err
				}
			}
		}
		return nil
	}
	err := visit(root, nil, false, 0)
	return rows, err
}
