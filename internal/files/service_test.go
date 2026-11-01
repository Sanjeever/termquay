package files

import (
	"context"
	"fmt"
	"io"
	"os"
	"path"
	"strconv"
	"testing"
	"time"

	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"github.com/pkg/sftp"
)

func TestSG1Files(t *testing.T) {
	if os.Getenv("SSH_MCP_SERVER_SG1_PASSWORD") == "" {
		t.Skip("未注入真实 SSH 测试凭据")
	}
	port, err := strconv.Atoi(os.Getenv("SSH_MCP_SERVER_SG1_PORT"))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	connection, err := terminal.Dial(ctx, terminal.Request{Host: os.Getenv("SSH_MCP_SERVER_SG1_HOST"), Port: port, Username: os.Getenv("SSH_MCP_SERVER_SG1_USERNAME"), Password: os.Getenv("SSH_MCP_SERVER_SG1_PASSWORD"), Fingerprint: os.Getenv("TERMQUAY_TEST_HOST_FINGERPRINT"), Cols: 80, Rows: 24})
	if err != nil {
		t.Fatal("真实 SFTP 连接失败")
	}
	defer connection.Close()
	client, err := connection.FileClient(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	dir := fmt.Sprintf("/tmp/termquay-%d", time.Now().UnixNano())
	if err = client.Mkdir(dir); err != nil {
		t.Fatal(err)
	}
	defer func() {
		entries, err := client.ReadDir(dir)
		if err != nil {
			t.Error(err)
			return
		}
		for _, entry := range entries {
			if err = client.Remove(path.Join(dir, entry.Name())); err != nil {
				t.Error(err)
			}
		}
		if err = client.RemoveDirectory(dir); err != nil {
			t.Error(err)
		}
	}()
	empty, err := List(ctx, client, dir)
	if err != nil || empty.Path != dir || len(empty.Entries) != 0 {
		t.Fatal("空目录路径或内容不一致")
	}
	stage, err := CreateStaging(client, dir)
	if err != nil {
		t.Fatal(err)
	}
	stageInfo, err := client.Stat(stage)
	if err != nil || stageInfo.Mode().Perm() != 0700 {
		t.Fatal("临时目录权限不是 0700")
	}
	if err = RemoveStaging(client, stage); err != nil {
		t.Fatal(err)
	}
	remote := path.Join(dir, "config.txt")
	f, err := client.OpenFile(remote, os.O_CREATE|os.O_EXCL|os.O_WRONLY)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = io.WriteString(f, "before\n"); err != nil {
		t.Fatal(err)
	}
	f.Chmod(0600)
	f.Close()
	doc, err := Read(client, remote)
	if err != nil {
		t.Fatal(err)
	}
	before, err := client.Lstat(remote)
	if err != nil {
		t.Fatal(err)
	}
	ownership := before.Sys().(*sftp.FileStat)
	doc.Content = "after\n"
	saved, err := Save(client, doc)
	if err != nil || saved.Content != "after\n" {
		t.Fatalf("原子保存失败: %v", err)
	}
	info, err := client.Stat(remote)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("保存没有保留权限")
	}
	afterOwnership := info.Sys().(*sftp.FileStat)
	if ownership.UID != afterOwnership.UID || ownership.GID != afterOwnership.GID {
		t.Fatal("保存没有保留属主与用户组")
	}
	f, err = client.OpenFile(remote, os.O_WRONLY|os.O_TRUNC)
	if err != nil {
		t.Fatal(err)
	}
	io.WriteString(f, "remote-change\n")
	f.Close()
	if _, err = Save(client, saved); err == nil {
		t.Fatal("未发现远端编辑冲突")
	}
	link := path.Join(dir, "link")
	if err = client.Symlink(remote, link); err != nil {
		t.Fatal(err)
	}
	if _, err = Read(client, link); err == nil {
		t.Fatal("允许隐式编辑符号链接")
	}
	entries, err := List(ctx, client, dir)
	if err != nil || len(entries.Entries) != 2 || entries.Path != dir {
		t.Fatal("目录读取不一致")
	}
	t.Log("真实 SFTP 浏览、保存、权限、冲突与符号链接检查通过")
}
