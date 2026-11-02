package monitor

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	terminal "github.com/Sanjeever/termquay/internal/ssh"
)

func sampleText(cpu, idle, rx, tx uint64) []byte {
	return []byte(fmt.Sprintf("[system]\nLinux test\n[cpu]\ncpu %d 0 0 %d 0 0 0 0 0 0\n[memory]\nMemTotal: 1000 kB\nMemAvailable: 500 kB\n[network]\neth0: %d 0 0 0 0 0 0 0 %d 0 0 0 0 0 0 0\n[disk]\n8 0 sda 1 0 2 0 1 0 3 0 0 0 0\n", cpu, idle, rx, tx))
}

func TestScriptUsesPOSIXLineEndings(t *testing.T) {
	if strings.Contains(Script, "\r") || !strings.HasPrefix(Script, "set -eu\n") {
		t.Fatal("嵌入脚本未转换为 POSIX 换行")
	}
}

func TestInitialRatesResetAndFailure(t *testing.T) {
	now := time.Now()
	first, err := Parse(sampleText(100, 100, 1000, 1000), now, nil)
	if err != nil {
		t.Fatal(err)
	}
	if first.CPU != nil || first.Network[0].ReadRate != nil {
		t.Fatal("首次采样伪造速率")
	}
	next, err := Parse(sampleText(150, 150, 3000, 5000), now.Add(2*time.Second), &first)
	if err != nil {
		t.Fatal(err)
	}
	if next.CPU == nil || *next.CPU != 50 || next.Network[0].ReadRate == nil || *next.Network[0].ReadRate != 1000 {
		t.Fatal("增量速率计算错误")
	}
	reset, err := Parse(sampleText(1, 1, 1, 1), now.Add(4*time.Second), &next)
	if err != nil {
		t.Fatal(err)
	}
	if reset.CPU != nil || reset.Network[0].ReadRate != nil {
		t.Fatal("计数重置伪造速率")
	}
	if _, err = Parse([]byte(strings.ReplaceAll(string(sampleText(1, 1, 1, 1)), "MemAvailable:", "Unavailable:")), now, nil); err == nil {
		t.Fatal("缺失内存数据未报错")
	}
}

func TestSG1Monitor(t *testing.T) {
	if os.Getenv("SSH_MCP_SERVER_SG1_PASSWORD") == "" {
		t.Skip("未注入真实 SSH 测试凭据")
	}
	port, err := strconv.Atoi(os.Getenv("SSH_MCP_SERVER_SG1_PORT"))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	connection, err := terminal.Dial(ctx, terminal.Request{Host: os.Getenv("SSH_MCP_SERVER_SG1_HOST"), Port: port, Username: os.Getenv("SSH_MCP_SERVER_SG1_USERNAME"), Password: os.Getenv("SSH_MCP_SERVER_SG1_PASSWORD"), Fingerprint: os.Getenv("TERMQUAY_TEST_HOST_FINGERPRINT"), Cols: 80, Rows: 24})
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	data, err := connection.Exec(ctx, Script, 256<<10)
	if err != nil {
		t.Fatal(err)
	}
	first, err := Parse(data, time.Now(), nil)
	if err != nil {
		t.Fatal(err)
	}
	data, err = connection.Exec(ctx, Script, 256<<10)
	if err != nil {
		t.Fatal(err)
	}
	next, err := Parse(data, time.Now(), &first)
	if err != nil {
		t.Fatal(err)
	}
	if next.MemoryTotal == 0 || next.CPU == nil {
		t.Fatal("真实 Linux 采集缺少数据")
	}
	data, err = connection.Exec(ctx, FileSystemScript, 256<<10)
	if err != nil {
		t.Fatal(err)
	}
	items, err := ParseFileSystems(data)
	if err != nil {
		t.Fatal(err)
	}
	root := false
	for _, item := range items {
		if item.Target == "/" && item.Size > 0 {
			root = true
		}
	}
	if !root {
		t.Fatal("真实文件系统容量缺少根挂载点")
	}
	t.Log("真实 Linux 独立 exec 通道采集通过，未在远端落地脚本")
}
