package app

import (
	"slices"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
)

type SSHRouteHop struct {
	Host          string `json:"host"`
	Port          int    `json:"port"`
	Username      string `json:"username"`
	JumpID        string `json:"jump_id"`
	ProxyAddress  string `json:"proxy_address"`
	AuthMethod    string `json:"auth_method"`
	IdentityAgent string `json:"identity_agent"`
	MFA           bool   `json:"mfa"`
	Certificate   string `json:"certificate"`
}

func sshRoute(chain []terminal.Request) []SSHRouteHop {
	route := make([]SSHRouteHop, 0, len(chain))
	for _, r := range chain {
		route = append(route, SSHRouteHop{r.Host, r.Port, r.Username, r.JumpID, r.ProxyAddress, r.AuthMethod, r.IdentityAgent, r.MFA, r.Certificate})
	}
	return route
}

func validateReconnectRoute(route, expected []SSHRouteHop) error {
	if len(expected) == 0 || len(expected) > 5 || !slices.Equal(route, expected) {
		return appmessage.New("backend:connectionDestinationJumpRouteOrAuthenticationConfigurationChanged", "连接目标、跳板路径或认证配置已改变，请手动连接")
	}
	for _, hop := range route {
		if hop.MFA || hop.AuthMethod == "keyboard_interactive" {
			return appmessage.New("backend:jumpChainRequiresManualAuthentication", "跳板链需要手动认证")
		}
	}
	return nil
}

func (a *AppService) resolveSSHChain(target terminal.Request) ([]terminal.Request, error) {
	chain := []terminal.Request{target}
	if target.JumpID == "" {
		return chain, nil
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return nil, err
	}
	data, err := a.store.Read()
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	for id := target.JumpID; id != ""; {
		if seen[id] || len(chain) >= 5 {
			return nil, appmessage.New("backend:sSHJumpChainContainsACycleOrExceeds", "SSH 跳板链存在循环或超过四跳")
		}
		seen[id] = true
		request, connection, err := a.requestFromData(data, id)
		if err != nil {
			return nil, err
		}
		if connection.Protocol != "ssh" {
			return nil, appmessage.New("backend:jumpHostsMustUseSSHConfigurations", "跳板必须使用 SSH 配置")
		}
		chain = append(chain, request)
		id = request.JumpID
	}
	slices.Reverse(chain)
	return chain, nil
}
