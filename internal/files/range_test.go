package files

import (
	"encoding/json"
	"errors"
	"net"
	"strings"
	"testing"

	"github.com/pkg/sftp"
	"golang.org/x/text/encoding/simplifiedchinese"
)

func rangeTestClient(t *testing.T) *sftp.Client {
	t.Helper()
	local, remote := net.Pipe()
	server := sftp.NewRequestServer(remote, sftp.InMemHandler())
	go func() { _ = server.Serve(); server.Close() }()
	client, err := sftp.NewClientPipe(local, local)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { client.Close(); local.Close(); remote.Close() })
	return client
}

func rangeTestWrite(t *testing.T, client *sftp.Client, remote string, data []byte) {
	t.Helper()
	file, err := client.Create(remote)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestReadRangePreservesCharacterBoundariesAndBudget(t *testing.T) {
	for _, charset := range []string{"UTF-8", "GBK", "GB18030"} {
		t.Run(charset, func(t *testing.T) {
			client := rangeTestClient(t)
			content := strings.Repeat("中文\t路径\r\n", 250)
			if charset != "GBK" {
				content += "😀\ufeff中"
			}
			data := []byte(content)
			var err error
			if charset == "GBK" {
				data, err = simplifiedchinese.GBK.NewEncoder().Bytes(data)
			}
			if charset == "GB18030" {
				data, err = simplifiedchinese.GB18030.NewEncoder().Bytes(data)
			}
			if err != nil {
				t.Fatal(err)
			}
			if charset == "UTF-8" {
				data = append([]byte{0xef, 0xbb, 0xbf}, data...)
			}
			rangeTestWrite(t, client, "/file", data)
			for _, limit := range []int{7, 8192} {
				offset, revision := int64(0), ""
				var output strings.Builder
				for page := 0; ; page++ {
					if page > len(data) {
						t.Fatal("续读未前进")
					}
					view, err := ReadRange(client, "/file", charset, revision, offset, limit, 1024)
					if err != nil {
						t.Fatal(err, offset, limit)
					}
					encoded, _ := json.Marshal(view)
					if len(encoded) > 1024 {
						t.Fatal("输出超过预算")
					}
					output.WriteString(view.Content)
					if view.NextOffset == nil {
						break
					}
					if *view.NextOffset <= offset {
						t.Fatal("续读未前进")
					}
					offset, revision = *view.NextOffset, view.Revision
				}
				if output.String() != content {
					t.Fatalf("续读丢失或重复字符，limit=%d", limit)
				}
			}
		})
	}
}

func TestReadRangeRejectsChangedBinaryAndSymlinkFiles(t *testing.T) {
	client := rangeTestClient(t)
	rangeTestWrite(t, client, "/file", []byte("original"))
	first, err := ReadRange(client, "/file", "UTF-8", "", 0, 4, 1024)
	if err != nil {
		t.Fatal(err)
	}
	rangeTestWrite(t, client, "/file", []byte("changed-size"))
	_, err = ReadRange(client, "/file", "UTF-8", first.Revision, 4, 4, 1024)
	var typed *ReadError
	if !errors.As(err, &typed) || typed.Code != "file_changed" {
		t.Fatal(err)
	}
	for _, data := range [][]byte{{0xff, 0xfe}, {'x', 0, 'y'}} {
		rangeTestWrite(t, client, "/file", data)
		if _, err := ReadRange(client, "/file", "UTF-8", "", 0, 8192, 1024); err == nil {
			t.Fatal("接受了无效文本")
		}
	}
	if err := client.Symlink("/file", "/link"); err != nil {
		t.Fatal(err)
	}
	_, err = ReadRange(client, "/link", "UTF-8", "", 0, 4, 1024)
	if !errors.As(err, &typed) || typed.Code != "file_not_regular" {
		t.Fatal(err)
	}
}
