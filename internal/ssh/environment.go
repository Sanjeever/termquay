package ssh

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"strings"
	"time"
	"unicode/utf16"
)

type RemoteEnvironment struct {
	OS         string `json:"os"`
	Shell      string `json:"shell"`
	Version    string `json:"version,omitempty"`
	Systemd    bool   `json:"systemd"`
	Services   bool   `json:"services"`
	Events     bool   `json:"events"`
	TCP        bool   `json:"tcp"`
	UDP        bool   `json:"udp"`
	UnixSocket bool   `json:"unix_socket"`
	CodePage   int    `json:"code_page,omitempty"`
	Warning    string `json:"warning,omitempty"`
}

const powerShellBootstrap = `$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Console]::InputEncoding=New-Object System.Text.UTF8Encoding;$OutputEncoding=[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding;try { & ([ScriptBlock]::Create([Console]::In.ReadToEnd()+[Environment]::NewLine+'if (-not $?) {if ($LASTEXITCODE) {exit $LASTEXITCODE};exit 1};exit 0'));exit 0 } catch {[Console]::Error.WriteLine($_.Exception.Message);exit 1}`

func powerShellCommand() string {
	units := utf16.Encode([]rune(powerShellBootstrap))
	encoded := make([]byte, len(units)*2)
	for i, unit := range units {
		binary.LittleEndian.PutUint16(encoded[i*2:], unit)
	}
	return "powershell.exe -NoLogo -NoProfile -NonInteractive -OutputFormat Text -EncodedCommand " + base64.StdEncoding.EncodeToString(encoded)
}

func (t *Terminal) Environment(ctx context.Context) RemoteEnvironment {
	t.mu.Lock()
	if t.environmentReady != nil {
		ready := t.environmentReady
		t.mu.Unlock()
		select {
		case <-ready:
			t.mu.Lock()
			result := t.environment
			t.mu.Unlock()
			return result
		case <-ctx.Done():
			return RemoteEnvironment{OS: "unknown", Warning: ctx.Err().Error()}
		}
	}
	t.environmentReady = make(chan struct{})
	t.mu.Unlock()
	probeCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	result := t.detectEnvironment(probeCtx)
	t.mu.Lock()
	t.environment = result
	close(t.environmentReady)
	if ctx.Err() != nil {
		t.environmentReady = nil
	}
	t.mu.Unlock()
	return result
}

func (t *Terminal) detectEnvironment(ctx context.Context) RemoteEnvironment {
	unknown := RemoteEnvironment{OS: "unknown", Warning: "无法识别远端系统与解释器；当前仅提供 SFTP 文件工具"}
	if strings.Contains(strings.ToLower(string(t.client.ServerVersion())), "windows") {
		return t.detectWindows(ctx, unknown)
	}
	result := t.runCommandRequest(ctx, "uname -s", "", "UTF-8")
	os := strings.TrimSpace(result.Stdout)
	if result.ExitCode == 0 && result.Error == "" && !result.Truncated && (os == "Linux" || os == "Darwin" || os == "FreeBSD" || os == "OpenBSD" || os == "NetBSD") {
		environment := RemoteEnvironment{OS: strings.ToLower(os), UnixSocket: true}
		probe := t.RunCommand(ctx, `printf 'TERMQUAY_SH\n'
command -v ss >/dev/null 2>&1 && printf 'ports\n'
if command -v systemctl >/dev/null 2>&1 && test -d /run/systemd/system; then printf 'systemd\n'; fi
exit 0`)
		if probe.ExitCode == 0 && probe.Error == "" && strings.HasPrefix(probe.Stdout, "TERMQUAY_SH\n") {
			environment.Shell = "sh"
			environment.TCP = os == "Linux" && strings.Contains(probe.Stdout, "\nports\n")
			environment.UDP = environment.TCP
			environment.Systemd = os == "Linux" && strings.Contains(probe.Stdout, "\nsystemd\n")
			environment.Services = environment.Systemd
			environment.Events = environment.Systemd
		} else {
			environment.Warning = "远端 POSIX Shell 探测失败"
		}
		return environment
	}
	if ctx.Err() != nil {
		unknown.Warning = ctx.Err().Error()
		return unknown
	}
	return t.detectWindows(ctx, unknown)
}

func (t *Terminal) detectWindows(ctx context.Context, failure RemoteEnvironment) RemoteEnvironment {
	result := t.RunScript(ctx, `if ($env:OS -ne 'Windows_NT') {throw '目标不是 Windows'}
@{os='windows';shell='powershell';version=$PSVersionTable.PSVersion.ToString();services=[bool](Get-Command Get-CimInstance -ErrorAction SilentlyContinue);events=[bool](Get-Command Get-WinEvent -ErrorAction SilentlyContinue);tcp=[bool](Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue);udp=[bool](Get-Command Get-NetUDPEndpoint -ErrorAction SilentlyContinue);code_page=[System.Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage} | ConvertTo-Json -Compress`, "powershell", "UTF-8")
	var environment RemoteEnvironment
	if result.ExitCode == 0 && result.Error == "" && !result.Truncated && json.Unmarshal([]byte(result.Stdout), &environment) == nil && environment.OS == "windows" && environment.Shell == "powershell" {
		return environment
	}
	if strings.Contains(strings.ToLower(string(t.client.ServerVersion())), "windows") {
		failure.OS = "windows"
		failure.Warning = "已识别 Windows SSH，但 PowerShell 探测失败；当前仅提供 SFTP 文件工具"
	}
	return failure
}
