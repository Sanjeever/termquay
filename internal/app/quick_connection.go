package app

import (
	"net"
	"strconv"
	"strings"
	"unicode"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	"github.com/Sanjeever/termquay/internal/store"
	"github.com/google/shlex"
)

func (a *AppService) ParseQuickConnection(value string) (store.Connection, error) {
	c := store.Connection{Protocol: "ssh", Port: 22}
	if len(value) > 4096 || strings.ContainsAny(value, "\r\n;|&`$<>#") {
		return c, appmessage.New("backend:quickConnectDoesNotSupportScriptsRedirectionOr", "快速连接不支持脚本、重定向或命令展开")
	}
	words, err := shlex.Split(value)
	if err != nil {
		return c, appmessage.New("backend:incompleteQuotesInAddressOrSSHCommand", "地址或 SSH 命令引号不完整")
	}
	if len(words) == 0 {
		return c, appmessage.New("backend:enterAnAddressOrSSHCommand", "请输入地址或 SSH 命令")
	}
	portSet := false
	if words[0] == "ssh" {
		words = words[1:]
		for len(words) > 0 && strings.HasPrefix(words[0], "-") {
			if len(words) < 2 || (words[0] != "-p" && words[0] != "-l") {
				return c, appmessage.New("backend:supportedSSHOptionsArePPortAndL", "支持的 SSH 选项为 -p <端口> 和 -l <用户名>")
			}
			if words[0] == "-p" {
				if portSet {
					return c, appmessage.New("backend:duplicatePort", "端口重复")
				}
				c.Port, err = strconv.Atoi(words[1])
				portSet = true
			} else {
				if c.Username != "" {
					return c, appmessage.New("backend:duplicateUsername", "用户名重复")
				}
				c.Username = words[1]
			}
			if err != nil {
				return c, appmessage.New("backend:invalidPort", "端口无效")
			}
			words = words[2:]
		}
	}
	if len(words) != 1 {
		return c, appmessage.New("backend:remoteCommandsOrExtraArgumentsAreUnsupported", "不支持远端命令或额外参数")
	}
	address := words[0]
	if i := strings.LastIndexByte(address, '@'); i >= 0 {
		if i == 0 {
			return c, appmessage.New("backend:usernameCannotBeEmpty", "用户名不能为空")
		}
		if c.Username != "" {
			return c, appmessage.New("backend:duplicateUsername", "用户名重复")
		}
		c.Username = address[:i]
		address = address[i+1:]
	}
	if strings.HasPrefix(address, "[") {
		if strings.HasSuffix(address, "]") {
			c.Host = strings.TrimSuffix(strings.TrimPrefix(address, "["), "]")
		} else {
			var port string
			c.Host, port, err = net.SplitHostPort(address)
			if err == nil {
				if portSet {
					return c, appmessage.New("backend:duplicatePort", "端口重复")
				}
				c.Port, err = strconv.Atoi(port)
			}
		}
	} else if strings.Count(address, ":") == 1 {
		var port string
		c.Host, port, err = net.SplitHostPort(address)
		if err == nil {
			if portSet {
				return c, appmessage.New("backend:duplicatePort", "端口重复")
			}
			c.Port, err = strconv.Atoi(port)
		}
	} else {
		c.Host = address
	}
	if err != nil || c.Port < 1 || c.Port > 65535 {
		return c, appmessage.New("backend:invalidAddressOrPortEncloseIPv6AddressesIn", "地址或端口无效；IPv6 带端口请使用方括号")
	}
	if c.Host == "" || strings.HasPrefix(c.Host, "-") || strings.ContainsAny(c.Host, "/\\@[]") || strings.ContainsAny(c.Username, "@/\\") || strings.IndexFunc(c.Host+c.Username, unicode.IsSpace) >= 0 {
		return c, appmessage.New("backend:invalidHostOrUsername", "主机或用户名无效")
	}
	if (strings.Contains(c.Host, ":") || strings.HasPrefix(address, "[")) && net.ParseIP(c.Host) == nil {
		return c, appmessage.New("backend:invalidIPv6Address", "IPv6 地址无效")
	}
	c.Name = c.Host
	return c, nil
}
