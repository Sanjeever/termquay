package app

import (
	"slices"
	"testing"
)

func TestRDPOriginsFollowDevPort(t *testing.T) {
	for _, port := range []string{"9245", "9356"} {
		t.Setenv("FRONTEND_DEVSERVER_URL", "http://127.0.0.1:"+port)
		origins := rdpOrigins()
		if !slices.Contains(origins, "http://wails.localhost:"+port) || !slices.Contains(origins, "http://127.0.0.1:"+port) {
			t.Fatal("未授权开发实例的实际 WebView 来源")
		}
		if slices.Contains(origins, "*") || slices.Contains(origins, "http://wails.localhost:9999") {
			t.Fatal("开发来源白名单过宽")
		}
	}
	t.Setenv("FRONTEND_DEVSERVER_URL", "http://untrusted.invalid:9245")
	if slices.Contains(rdpOrigins(), "http://untrusted.invalid:9245") {
		t.Fatal("授权了非回环开发服务器")
	}
}
