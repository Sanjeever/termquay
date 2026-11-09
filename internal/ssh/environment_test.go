package ssh

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"os/exec"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	gossh "golang.org/x/crypto/ssh"
	"golang.org/x/text/encoding/simplifiedchinese"
)

func commandTestTerminal(t *testing.T, version string, execute func(string, string) (string, string, uint32)) *Terminal {
	t.Helper()
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := gossh.NewSignerFromKey(key)
	if err != nil {
		t.Fatal(err)
	}
	config := &gossh.ServerConfig{NoClientAuth: true, ServerVersion: version}
	config.AddHostKey(signer)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	go func() {
		raw, err := listener.Accept()
		if err != nil {
			return
		}
		conn, channels, requests, err := gossh.NewServerConn(raw, config)
		if err != nil {
			raw.Close()
			return
		}
		defer conn.Close()
		go gossh.DiscardRequests(requests)
		for next := range channels {
			channel, requests, err := next.Accept()
			if err != nil {
				continue
			}
			go func() {
				defer channel.Close()
				for request := range requests {
					if request.Type != "exec" {
						request.Reply(false, nil)
						continue
					}
					var payload struct{ Command string }
					if gossh.Unmarshal(request.Payload, &payload) != nil {
						return
					}
					request.Reply(true, nil)
					data, err := io.ReadAll(io.LimitReader(channel, 40<<10))
					if err != nil {
						return
					}
					stdout, stderr, code := execute(payload.Command, string(data))
					fmt.Fprint(channel, stdout)
					fmt.Fprint(channel.Stderr(), stderr)
					channel.SendRequest("exit-status", false, gossh.Marshal(struct{ Status uint32 }{code}))
					return
				}
			}()
		}
	}()
	client, err := gossh.Dial("tcp", listener.Addr().String(), &gossh.ClientConfig{User: "fixture", HostKeyCallback: gossh.FixedHostKey(signer.PublicKey()), Timeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { client.Close() })
	return &Terminal{client: client}
}

func TestEnvironmentDetectionAndConnectionCache(t *testing.T) {
	for _, windows := range []bool{false, true} {
		t.Run(fmt.Sprint(windows), func(t *testing.T) {
			var calls atomic.Int32
			version := "SSH-2.0-OpenSSH_9.0"
			if windows {
				version = "SSH-2.0-OpenSSH_for_Windows_9.5"
			}
			term := commandTestTerminal(t, version, func(command, input string) (string, string, uint32) {
				calls.Add(1)
				if windows {
					if !strings.HasPrefix(command, "powershell.exe ") || !strings.Contains(input, "Get-NetTCPConnection") {
						t.Error("Windows 探测依赖了 POSIX Shell")
					}
					return `{"os":"windows","shell":"powershell","version":"5.1","tcp":true,"udp":true,"services":true}`, "", 0
				}
				if command == "uname -s" {
					return "Linux\n", "", 0
				}
				return "TERMQUAY_SH\nports\nsystemd\n", "", 0
			})
			first := term.Environment(t.Context())
			second := term.Environment(t.Context())
			if first != second || !first.Services || !first.TCP || (windows && first.Shell != "powershell") || (!windows && first.Shell != "sh") {
				t.Fatal(first, second)
			}
			want := int32(2)
			if windows {
				want = 1
			}
			if calls.Load() != want {
				t.Fatal("重复探测", calls.Load())
			}
		})
	}
}

func TestUnknownEnvironmentDoesNotAssumeLinux(t *testing.T) {
	term := commandTestTerminal(t, "SSH-2.0-fixture", func(string, string) (string, string, uint32) { return "", "unavailable", 1 })
	e := term.Environment(t.Context())
	if e.OS != "unknown" || e.Shell != "" || e.Services || e.UnixSocket || e.Warning == "" {
		t.Fatal(e)
	}
}

func TestCommandOutputEncodingPreservesBytes(t *testing.T) {
	raw, err := simplifiedchinese.GBK.NewEncoder().Bytes([]byte("不是内部或外部命令"))
	if err != nil {
		t.Fatal(err)
	}
	text, encoded, err := decodeCommandOutput(raw, "UTF-8", false)
	if text != "" || encoded != base64.StdEncoding.EncodeToString(raw) || err == nil {
		t.Fatal(text, encoded, err)
	}
	text, encoded, err = decodeCommandOutput(raw, "GBK", false)
	if text != "不是内部或外部命令" || encoded != "" || err != nil {
		t.Fatal(text, encoded, err)
	}
}

func TestPowerShell51Execution(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("需要原生 Windows PowerShell 5.1")
	}
	powershell, err := exec.LookPath("powershell.exe")
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name, script, want string
		code               int
	}{
		{"unicode", "'中文路径 C:\\测试 目录'", "中文路径 C:\\测试 目录", 0},
		{"long", "#" + strings.Repeat("长", 9000) + "\n'long-ok'", "long-ok", 0},
		{"parse_error", "if (", "", 1},
		{"cmdlet_error", "Get-Item -LiteralPath 'Z:\\termquay-missing-fixture'", "", 1},
		{"native_error", "cmd.exe /d /c exit 17", "", 17},
		{"explicit_exit", "exit 23", "", 23},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
			defer cancel()
			command := exec.CommandContext(ctx, powershell, strings.Fields(strings.TrimPrefix(powerShellCommand(), "powershell.exe "))...)
			command.Stdin = strings.NewReader(test.script)
			output, err := command.Output()
			code := 0
			if err != nil {
				exit, valid := err.(*exec.ExitError)
				if !valid {
					t.Fatal(err)
				}
				code = exit.ExitCode()
			}
			if code != test.code || strings.TrimSpace(string(output)) != test.want {
				t.Fatalf("code=%d output=%q err=%v", code, output, err)
			}
		})
	}
}
