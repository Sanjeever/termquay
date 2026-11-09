//go:build windows

package app

import (
	"errors"

	"net/url"
	"unicode/utf8"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	"golang.org/x/sys/windows/registry"
)

func readPuTTYSessions() ([]SSHImportRow, []error, error) {
	key, err := registry.OpenKey(registry.CURRENT_USER, `Software\SimonTatham\PuTTY\Sessions`, registry.READ)
	if err != nil {
		return nil, nil, appmessage.Errorf("backend:couldNotReadTheCurrentUserSPuTTY", "无法读取当前用户 PuTTY 会话：%w", err)
	}
	defer key.Close()
	names, err := key.ReadSubKeyNames(513)
	if err != nil {
		return nil, nil, err
	}
	if len(names) > 512 {
		return nil, nil, appmessage.New("backend:puTTYSessionCountExceeds512", "PuTTY 会话超过 512 项")
	}
	rows := []SSHImportRow{}
	warnings := []error{appmessage.New("backend:puttyReconfigure", "导入主机、端口和用户名；凭据、PPK 私钥、启动命令及转发需要重新配置。")}
	for _, encoded := range names {
		name, err := url.PathUnescape(encoded)
		if err != nil || !utf8.ValidString(name) {
			return nil, nil, appmessage.New("backend:invalidPuTTYSessionNameEncoding", "PuTTY 会话名称编码无效")
		}
		session, err := registry.OpenKey(key, encoded, registry.QUERY_VALUE)
		if err != nil {
			return nil, nil, err
		}
		read := func(field string) (string, error) {
			value, _, err := session.GetStringValue(field)
			if errors.Is(err, registry.ErrNotExist) {
				return "", nil
			}
			return value, err
		}
		host, err := read("HostName")
		if err != nil {
			session.Close()
			return nil, nil, err
		}
		if host == "" {
			session.Close()
			continue
		}
		protocol, err := read("Protocol")
		if err != nil {
			session.Close()
			return nil, nil, err
		}
		if protocol != "ssh" {
			warnings = append(warnings, appmessage.Errorf("backend:nonSSHSessionSkipped", "%s：非 SSH 会话未导入", name))
			session.Close()
			continue
		}
		username, err := read("UserName")
		if err != nil {
			session.Close()
			return nil, nil, err
		}
		port, _, err := session.GetIntegerValue("PortNumber")
		if err != nil {
			session.Close()
			return nil, nil, err
		}
		if port < 1 || port > 65535 {
			session.Close()
			return nil, nil, appmessage.New("backend:invalidPuTTYSessionPort", "PuTTY 会话端口无效")
		}
		proxy, _, err := session.GetIntegerValue("ProxyMethod")
		if errors.Is(err, registry.ErrNotExist) {
			proxy = 0
		} else if err != nil {
			session.Close()
			return nil, nil, err
		}
		row := puttyImportRow(name, host, username, int(port))
		if proxy != 0 {
			appendImportNotices(&row.Warnings, &row.WarningMessages, appmessage.New("backend:proxyNotMigrated", "代理配置未迁移，已阻止降级直连导入"))
		}
		if username == "" {
			warnings = append(warnings, appmessage.Errorf("backend:missingSavedUsername", "%s：未保存用户名，连接前需编辑填写", name))
		}
		rows = append(rows, row)
		session.Close()
	}
	return rows, warnings, nil
}
