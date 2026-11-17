package files

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"testing"

	"github.com/pkg/sftp"
	directorysftp "github.com/pkg/sftp/v2"
)

type directoryEntryName struct {
	os.FileInfo
	name string
}

func (e directoryEntryName) Name() string { return e.name }

type directoryNames struct {
	sftp.FileLister
	names []string
}

func (h directoryNames) Filelist(request *sftp.Request) (sftp.ListerAt, error) {
	list, err := h.FileLister.Filelist(request)
	if err != nil || request.Method != "List" {
		return list, err
	}
	return prefixedDirectory{list, h.names}, nil
}

type prefixedDirectory struct {
	sftp.ListerAt
	names []string
}

func (l prefixedDirectory) ListAt(entries []os.FileInfo, offset int64) (int, error) {
	info, err := os.Stat(os.TempDir())
	if err != nil {
		return 0, err
	}
	count := 0
	for offset < int64(len(l.names)) && count < len(entries) {
		entries[count] = directoryEntryName{FileInfo: info, name: l.names[offset]}
		count++
		offset++
	}
	if count == len(entries) {
		return count, nil
	}
	n, err := l.ListerAt.ListAt(entries[count:], offset-int64(len(l.names)))
	return count + n, err
}

func TestDeleteDirectoryEntries(t *testing.T) {
	for _, nonempty := range []bool{false, true} {
		t.Run(fmt.Sprint("nonempty=", nonempty), func(t *testing.T) {
			handlers := sftp.InMemHandler()
			names := []string{".", ".."}
			handlers.FileList = directoryNames{handlers.FileList, names}
			local, remote := net.Pipe()
			server := sftp.NewRequestServer(remote, handlers)
			go func() { _ = server.Serve(); server.Close() }()
			client, err := directorysftp.NewClientPipe(t.Context(), local, local)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { client.Close(); local.Close(); remote.Close() })
			if err := client.Mkdir("/tree", 0700); err != nil {
				t.Fatal(err)
			}
			if nonempty {
				file, err := client.Create("/tree/file")
				if err != nil {
					t.Fatal(err)
				}
				if _, err = io.WriteString(file, "keep until deletion"); err != nil {
					t.Fatal(err)
				}
				file.Close()
			}
			err = Delete(context.Background(), client, "/tree", nil)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = client.LStat("/tree"); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("directory still exists: %v", err)
			}
		})
	}
}
