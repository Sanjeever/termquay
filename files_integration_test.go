package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"path"
	"testing"
	"time"

	"github.com/Sanjeever/termquay/internal/files"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
)

func TestSavedConnectionFileEditing(t *testing.T) {
	id := os.Getenv("TERMQUAY_TEST_SAVED_CONNECTION")
	if id == "" {
		t.Skip("未选择真实文件测试连接")
	}
	app := NewAppService()
	auth, connection, err := app.savedRequest(id)
	if err != nil {
		t.Fatal("读取真实测试连接失败")
	}
	defer app.store.Close()
	if connection.Protocol != "ssh" {
		t.Fatal("真实文件测试需要 SSH 连接")
	}
	auth.Fingerprint = os.Getenv("TERMQUAY_TEST_HOST_FINGERPRINT")
	if auth.Fingerprint == "" {
		t.Fatal("缺少已核对的测试目标指纹")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	ssh, err := terminal.Dial(ctx, auth)
	if err != nil {
		t.Fatal("真实 SSH 认证或身份验证失败")
	}
	defer ssh.Close()
	client, err := ssh.FileClient(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	directory := fmt.Sprintf("/tmp/termquay-editor-%d", time.Now().UnixNano())
	if err = client.Mkdir(directory); err != nil {
		t.Fatal(err)
	}
	defer func() {
		entries, e := client.ReadDir(directory)
		if e != nil {
			t.Error(e)
			return
		}
		for _, entry := range entries {
			if entry.IsDir() {
				e = client.RemoveDirectory(path.Join(directory, entry.Name()))
			} else {
				e = client.Remove(path.Join(directory, entry.Name()))
			}
			if e != nil {
				t.Error(e)
			}
		}
		if e = client.RemoveDirectory(directory); e != nil {
			t.Error(e)
		}
	}()
	filename := path.Join(directory, "config.yaml")
	file, err := client.Create(filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = io.WriteString(file, "name: 初始\n"); err != nil {
		t.Fatal(err)
	}
	file.Chmod(0600)
	file.Close()
	document, err := files.Read(client, filename)
	if err != nil {
		t.Fatal(err)
	}
	for _, encoding := range []string{"GBK", "GB2312", "GB18030", "UTF-8"} {
		document.Content = "name: 中文\nvalue: 测试\n"
		document.Encoding = encoding
		document.LineEnding = "CRLF"
		document.BOM = encoding == "UTF-8"
		expected, e := files.EncodeDocument(document)
		if e != nil {
			t.Fatal(e)
		}
		document, err = files.Save(client, document)
		if err != nil {
			t.Fatal(err)
		}
		remote, e := client.Open(filename)
		if e != nil {
			t.Fatal(e)
		}
		raw, e := io.ReadAll(remote)
		remote.Close()
		if e != nil || !bytes.Equal(expected, raw) {
			t.Fatal("真实 SFTP 保存的编码、换行或 BOM 不一致")
		}
	}
	stale := document
	document.Content = "changed\r\n"
	document, err = files.Save(client, document)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = files.Save(client, stale); err == nil {
		t.Fatal("编码转换后未阻止旧版本覆盖")
	}
	target := path.Join(directory, "target")
	if err = client.Mkdir(target); err != nil {
		t.Fatal(err)
	}
	link := path.Join(directory, "alias")
	if err = client.Symlink("target", link); err != nil {
		t.Fatal(err)
	}
	loop := path.Join(directory, "loop")
	if err = client.Symlink(".", loop); err != nil {
		t.Fatal(err)
	}
	listing, err := files.List(ctx, client, directory)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, entry := range listing.Entries {
		if entry.Path == link {
			found = entry.Directory && entry.Symlink && entry.LinkTarget == "target" && entry.LinkResolved == target
		}
	}
	if !found {
		t.Fatal("真实目录链接元数据不完整")
	}
	listing, err = files.List(ctx, client, link)
	if err != nil || listing.Path != link {
		t.Fatal("真实目录链接展开失败")
	}
	if _, err = files.List(ctx, client, loop); err == nil {
		t.Fatal("真实目录链接循环未阻止")
	}
}
