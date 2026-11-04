package app

import (
	"slices"
	"testing"
)

func TestReconnectRouteChanges(t *testing.T) {
	original := []SSHRouteHop{{Host: "gateway", Port: 22, Username: "operator", AuthMethod: "agent"}, {Host: "target", Port: 22, Username: "operator", JumpID: "same-gateway-id", AuthMethod: "password"}}
	if err := validateReconnectRoute(original, original); err != nil {
		t.Fatal(err)
	}
	changes := map[string]func([]SSHRouteHop){
		"同 ID 跳板目标": func(r []SSHRouteHop) { r[0].Host = "other-gateway" },
		"跳板用户":      func(r []SSHRouteHop) { r[0].Username = "other-user" },
		"跳板代理":      func(r []SSHRouteHop) { r[0].ProxyAddress = "127.0.0.1:1080" },
		"跳板认证":      func(r []SSHRouteHop) { r[0].AuthMethod = "keyboard_interactive" },
		"跳板 Agent":  func(r []SSHRouteHop) { r[0].IdentityAgent = "/other-agent" },
		"跳板 MFA":    func(r []SSHRouteHop) { r[0].MFA = true },
		"目标端口":      func(r []SSHRouteHop) { r[1].Port = 2222 },
	}
	for name, change := range changes {
		t.Run(name, func(t *testing.T) {
			current := slices.Clone(original)
			change(current)
			if validateReconnectRoute(current, original) == nil {
				t.Fatal("配置变化未阻止重连")
			}
		})
	}
	if validateReconnectRoute(original[:1], original) == nil || validateReconnectRoute(original, nil) == nil {
		t.Fatal("缺失路径未阻止重连")
	}
	interactive := slices.Clone(original)
	interactive[0].MFA = true
	if validateReconnectRoute(interactive, interactive) == nil {
		t.Fatal("交互跳板未阻止重连")
	}
}
