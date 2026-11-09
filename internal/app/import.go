package app

import (
	"encoding/base64"
	"encoding/json"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	"github.com/Sanjeever/termquay/internal/store"
	"github.com/google/shlex"
	sshconfig "github.com/kevinburke/ssh_config"
	"github.com/wailsapp/wails/v3/pkg/application"
	"io"
	"os"
	"os/user"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"time"
)

type SSHImportRow struct {
	ID           string           `json:"id"`
	Connection   store.Connection `json:"connection"`
	Conflict     string           `json:"conflict"`
	IdentityFile string           `json:"identity_file"`
	JumpAlias    string           `json:"jump_alias"`
	Warnings     []string         `json:"warnings"`
	Notes        []string         `json:"notes"`
	GroupPath    []string         `json:"group_path"`
}
type SSHImportPreview struct {
	ID       string         `json:"id"`
	Rows     []SSHImportRow `json:"rows"`
	Warnings []string       `json:"warnings"`
	base     store.Data
	expires  time.Time
}
type SSHImportChoice struct {
	ID     string `json:"id"`
	Action string `json:"action"`
}

func (a *AppService) SelectSSHImport() (SSHImportPreview, error) {
	names, err := application.Get().Dialog.OpenFile().SetTitle(nativeText("Select OpenSSH configuration and explicitly authorized Include files", "选择 OpenSSH 配置及明确授权的 Include 文件")).PromptForMultipleSelection()
	if err != nil {
		return SSHImportPreview{}, err
	}
	return a.previewSSHImportFiles(names)
}

func (a *AppService) previewSSHImportFiles(names []string) (SSHImportPreview, error) {
	if len(names) == 0 || len(names) > 16 {
		return SSHImportPreview{}, appmessage.New("backend:selectFrom1To16ConfigurationFiles", "请选择 1 至 16 个配置文件")
	}
	approved := map[string]string{}
	total := 0
	for _, name := range names {
		f, e := os.Open(name)
		if e != nil {
			return SSHImportPreview{}, e
		}
		data, e := io.ReadAll(io.LimitReader(f, (1<<20)+1))
		f.Close()
		total += len(data)
		if e != nil {
			return SSHImportPreview{}, e
		}
		if total > 1<<20 {
			return SSHImportPreview{}, appmessage.New("backend:configurationExceeds1MiB", "配置超过 1 MiB")
		}
		absolute, e := filepath.Abs(name)
		if e != nil {
			return SSHImportPreview{}, e
		}
		approved[filepath.Clean(absolute)] = string(data)
	}
	visited := map[string]bool{}
	warnings := []string{}
	var expand func(string, int, map[string]bool) (string, error)
	size := 0
	expand = func(name string, depth int, stack map[string]bool) (string, error) {
		if depth > 8 || stack[name] {
			return "", appmessage.New("backend:includeDepthExceedsEightLevelsOrContainsA", "Include 超过八层或存在循环")
		}
		stack[name] = true
		defer delete(stack, name)
		visited[name] = true
		var result strings.Builder
		for _, line := range strings.Split(approved[name], "\n") {
			key, values, err := sshImportDirective(line)
			if err != nil {
				return "", err
			}
			if key == "include" {
				if len(values) == 0 {
					return "", appmessage.New("backend:includeFilePathMissing", "Include 缺少文件路径")
				}
				for _, pattern := range values {
					if !filepath.IsAbs(pattern) {
						pattern = filepath.Join(filepath.Dir(name), pattern)
					}
					matched := false
					selectedNames := make([]string, 0, len(approved))
					for selected := range approved {
						selectedNames = append(selectedNames, selected)
					}
					sort.Strings(selectedNames)
					for _, selected := range selectedNames {
						ok, err := filepath.Match(pattern, selected)
						if err != nil {
							return "", appmessage.New("backend:invalidIncludePathPattern", "Include 路径模式无效")
						}
						if ok {
							matched = true
							part, e := expand(selected, depth+1, stack)
							if e != nil {
								return "", e
							}
							result.WriteString(part)
						}
					}
					if !matched {
						warnings = append(warnings, "Include 文件未明确选择，未读取")
					}
				}
				continue
			}
			size += len(line) + 1
			if size > 1<<20 {
				return "", appmessage.New("backend:expandedConfigurationExceeds1MiB", "展开配置超过 1 MiB")
			}
			result.WriteString(line + "\n")
		}
		return result.String(), nil
	}
	var text strings.Builder
	for _, name := range names {
		absolute, err := filepath.Abs(name)
		if err != nil {
			return SSHImportPreview{}, err
		}
		absolute = filepath.Clean(absolute)
		if !visited[absolute] {
			part, e := expand(absolute, 0, map[string]bool{})
			if e != nil {
				return SSHImportPreview{}, e
			}
			text.WriteString(part)
		}
	}
	p, err := a.PreviewSSHImport(text.String())
	p.Warnings = append(p.Warnings, warnings...)
	return p, err
}

func sshImportDirective(line string) (string, []string, error) {
	words, err := shlex.Split(line)
	if err != nil {
		return "", nil, appmessage.New("backend:invalidOpenSSHConfigurationQuotingOrEscaping", "OpenSSH 配置引号或转义无效")
	}
	if len(words) == 0 {
		return "", nil, nil
	}
	key, value, equals := strings.Cut(words[0], "=")
	values := words[1:]
	if equals && value != "" {
		values = append([]string{value}, values...)
	} else if !equals && len(values) > 0 && strings.HasPrefix(values[0], "=") {
		value = strings.TrimPrefix(values[0], "=")
		values = values[1:]
		if value != "" {
			values = append([]string{value}, values...)
		}
	}
	return strings.ToLower(key), values, nil
}

func (a *AppService) PreviewSSHImport(text string) (SSHImportPreview, error) {
	if len(text) > 1<<20 {
		return SSHImportPreview{}, appmessage.New("backend:configurationExceeds1MiB", "配置超过 1 MiB")
	}
	warnings := []string{}
	lines := []string{}
	match := false
	for _, line := range strings.Split(text, "\n") {
		key, _, err := sshImportDirective(line)
		if err != nil {
			return SSHImportPreview{}, err
		}
		if key == "" {
			lines = append(lines, line)
			continue
		}
		if key == "include" {
			warnings = append(warnings, "Include 未读取，请明确选择引用文件")
			continue
		}
		if key == "match" {
			match = true
			warnings = append(warnings, "Match 块不支持，未执行")
			continue
		}
		if key == "host" {
			match = false
		}
		if !match {
			lines = append(lines, line)
		}
	}
	config, err := sshconfig.Decode(strings.NewReader(strings.Join(lines, "\n")))
	if err != nil {
		return SSHImportPreview{}, appmessage.New("backend:invalidOpenSSHConfigurationSyntax", "OpenSSH 配置语法无效")
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err = a.openStorage(); err != nil {
		return SSHImportPreview{}, err
	}
	data, err := a.store.Read()
	if err != nil {
		return SSHImportPreview{}, err
	}
	p := SSHImportPreview{ID: base64.RawURLEncoding.EncodeToString(randomBytes(18)), Rows: []SSHImportRow{}, Warnings: warnings, base: data, expires: time.Now().Add(10 * time.Minute)}
	seen := map[string]bool{}
	for _, block := range config.Hosts {
		for _, node := range block.Nodes {
			if kv, ok := node.(*sshconfig.KV); ok {
				key := strings.ToLower(kv.Key)
				if key != "hostname" && key != "user" && key != "port" && key != "identityfile" && key != "identityagent" && key != "proxyjump" {
					p.Warnings = append(p.Warnings, "未支持指令："+kv.Key)
				}
			}
		}
		for _, pattern := range block.Patterns {
			alias := pattern.String()
			if strings.ContainsAny(alias, "*?!") {
				if alias != "*" {
					p.Warnings = append(p.Warnings, "未展开模式："+alias)
				}
				continue
			}
			if seen[alias] {
				continue
			}
			seen[alias] = true
			if len(p.Rows) >= 512 {
				return SSHImportPreview{}, appmessage.New("backend:hostCountExceeds512", "Host 超过 512 个")
			}
			get := func(key string) string { v, _ := config.Get(alias, key); return v }
			host := get("HostName")
			if host == "" {
				host = alias
			}
			port := 22
			if value := get("Port"); value != "" {
				port, err = strconv.Atoi(value)
				if err != nil || port < 1 || port > 65535 {
					return SSHImportPreview{}, appmessage.New("backend:invalidConfiguredPort", "配置端口无效")
				}
			}
			row := SSHImportRow{ID: base64.RawURLEncoding.EncodeToString(randomBytes(16)), Connection: store.Connection{Name: alias, Protocol: "ssh", Host: host, Port: port, Username: get("User")}, IdentityFile: get("IdentityFile"), JumpAlias: get("ProxyJump"), Warnings: []string{}}
			if value := get("ProxyCommand"); value != "" && value != "none" {
				row.Warnings = append(row.Warnings, "ProxyCommand 不执行，也不能降级为直连导入")
			}
			if row.Connection.Username == "" {
				current, e := user.Current()
				if e != nil {
					row.Warnings = append(row.Warnings, "无法确定默认用户名，请填写 User")
				} else {
					row.Connection.Username = current.Username
					if i := strings.LastIndex(row.Connection.Username, `\`); i >= 0 {
						row.Connection.Username = row.Connection.Username[i+1:]
					}
				}
			}
			if strings.ContainsAny(host, "%$") {
				row.Warnings = append(row.Warnings, "HostName 展开不支持")
			}
			if strings.ContainsAny(row.JumpAlias, ",@:") {
				row.Warnings = append(row.Warnings, "仅映射具体 Host 的单跳 ProxyJump")
			}
			if row.IdentityFile != "" {
				row.Connection.AuthMethod = "private_key"
				if strings.HasPrefix(row.IdentityFile, "~/") {
					home, e := os.UserHomeDir()
					if e != nil {
						return SSHImportPreview{}, e
					}
					row.IdentityFile = filepath.Join(home, row.IdentityFile[2:])
				}
				if !filepath.IsAbs(row.IdentityFile) || strings.ContainsAny(row.IdentityFile, "%$") {
					row.Warnings = append(row.Warnings, "IdentityFile 需要绝对路径")
				}
			} else if agent := get("IdentityAgent"); agent != "" && agent != "none" {
				row.Connection.AuthMethod = "agent"
				row.Connection.IdentityAgent = agent
			}
			for _, old := range data.Connections {
				if old.Name == alias {
					row.Conflict = old.ID
					break
				}
			}
			p.Rows = append(p.Rows, row)
		}
	}
	a.importPreview = &p
	return p, nil
}
func (a *AppService) ConfirmSSHImport(id string, choices []SSHImportChoice) error {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	p := a.importPreview
	if p == nil || p.ID != id || time.Now().After(p.expires) {
		return appmessage.New("backend:importPreviewNoLongerValid", "导入预览已失效")
	}
	current, err := a.store.Read()
	if err != nil {
		return err
	}
	if !reflect.DeepEqual(current, p.base) {
		return appmessage.New("backend:connectionChangedPreviewAgain", "连接已变化，请重新预览")
	}
	selected := map[string]string{}
	known := map[string]bool{}
	for _, row := range p.Rows {
		known[row.ID] = true
	}
	if len(choices) > len(p.Rows) {
		return appmessage.New("backend:importSelectionExceedsPreviewCount", "导入选择超过预览数量")
	}
	for _, choice := range choices {
		if !known[choice.ID] || selected[choice.ID] != "" || (choice.Action != "new" && choice.Action != "replace" && choice.Action != "skip") {
			return appmessage.New("backend:invalidImportSelection", "导入选择无效")
		}
		selected[choice.ID] = choice.Action
	}
	aliases := map[string]string{}
	for _, row := range p.Rows {
		if selected[row.ID] == "new" {
			aliases[row.Connection.Name] = row.ID
		} else if selected[row.ID] == "replace" && row.Conflict != "" {
			aliases[row.Connection.Name] = row.Conflict
		}
	}
	for _, c := range current.Connections {
		if c.Protocol == "ssh" && aliases[c.Name] == "" {
			aliases[c.Name] = c.ID
		}
	}
	preferences, err := a.store.ConnectionPreferences()
	if err != nil {
		return err
	}
	for _, row := range p.Rows {
		action := selected[row.ID]
		if action == "" || action == "skip" {
			continue
		}
		if len(row.Warnings) > 0 {
			return appmessage.New("backend:selectedEntriesHaveUnsupportedFieldsCorrectThemFirst", "所选条目有不支持字段，请修正")
		}
		c := row.Connection
		parent := ""
		for _, name := range row.GroupPath {
			groupID := ""
			for _, group := range current.Groups {
				if group.ParentID == parent && group.Name == name {
					groupID = group.ID
					break
				}
			}
			if groupID == "" {
				groupID = base64.RawURLEncoding.EncodeToString(randomBytes(16))
				current.Groups = append(current.Groups, store.Group{ID: groupID, ParentID: parent, Name: name})
			}
			parent = groupID
		}
		if len(row.GroupPath) > 0 {
			c.GroupID = parent
		}
		c.ID = row.ID
		if action == "replace" {
			if row.Conflict == "" {
				return appmessage.New("backend:replacementDestinationDoesNotExist", "替换目标不存在")
			}
			c.ID = row.Conflict
		}
		if row.JumpAlias != "" && row.JumpAlias != "none" {
			c.JumpID = aliases[row.JumpAlias]
			if c.JumpID == "" {
				return appmessage.New("backend:proxyJumpNotSelectedOrCannotBeMapped", "ProxyJump 未选择或不能映射")
			}
		}
		found := false
		for i, old := range current.Connections {
			if old.ID == c.ID {
				current.Connections[i] = c
				found = true
				break
			}
		}
		if !found {
			current.Connections = append(current.Connections, c)
		}
		pref := preferences[c.ID]
		pref.PrivateKeyPath = row.IdentityFile
		preferences[c.ID] = pref
	}
	used := map[string]bool{}
	for _, c := range current.Connections {
		used[c.CredentialID] = true
	}
	credentials := current.Credentials[:0]
	for _, c := range current.Credentials {
		if used[c.ID] {
			credentials = append(credentials, c)
		}
	}
	current.Credentials = credentials
	encoded, err := json.Marshal(preferences)
	if err != nil {
		return err
	}
	if err = a.store.ReplaceWithSettings(current, map[string]string{"connection_preferences": string(encoded)}); err != nil {
		return err
	}
	a.importPreview = nil
	return nil
}
