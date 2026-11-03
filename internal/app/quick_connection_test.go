package app

import "testing"

func TestQuickConnectionForms(t *testing.T) {
	a := NewAppService(BuildInfo{Development: true}, nil)
	for _, tt := range []struct {
		input, host, user string
		port              int
	}{
		{"root@example.invalid", "example.invalid", "root", 22},
		{"test@host:2222", "host", "test", 2222},
		{"root@[2001:db8::1]:2200", "2001:db8::1", "root", 2200},
		{"[2001:db8::1]", "2001:db8::1", "", 22},
		{"ssh -p 2222 -l 'test-user' host", "host", "test-user", 2222},
		{"ssh -l test -p 2200 2001:db8::1", "2001:db8::1", "test", 2200},
	} {
		c, err := a.ParseQuickConnection(tt.input)
		if err != nil || c.Host != tt.host || c.Username != tt.user || c.Port != tt.port {
			t.Fatalf("解析 %q: %v", tt.input, err)
		}
	}
	for _, input := range []string{"", "ssh -o ProxyCommand=anything host", "ssh host uname", "ssh -p 0 host", "ssh -p 22 user@host:23", "ssh -l a b@host", "user@host;uname", "$(uname)", "host\necho x", "[invalid]:22", "ssh 'host", "ssh -p x host"} {
		if _, err := a.ParseQuickConnection(input); err == nil {
			t.Fatalf("接受不支持输入 %q", input)
		}
	}
}
