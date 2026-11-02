package monitor

import (
	"strings"
	"testing"
)

func TestFileSystemsPreservePathsAndReservedSpace(t *testing.T) {
	items, err := ParseFileSystems([]byte(`{"filesystems":[{"source":"/dev/vda1","target":"/mnt/中文 data\tset","fstype":"ext4","size":1000,"used":600,"avail":300}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Target != "/mnt/中文 data\tset" || items[0].Available != 300 || items[0].Used != 600 {
		t.Fatal("路径或保留空间被改写")
	}
}

func TestFileSystemsRejectMissingInvalidAndUnboundedData(t *testing.T) {
	for _, data := range []string{
		`{}`, `{"filesystems":[]}`, `{"filesystems":[{"source":"x","target":"/","fstype":"ext4","size":100,"used":0}]}`,
		`{"filesystems":[{"source":"x","target":"/","fstype":"ext4","size":100,"used":101,"avail":0}]}`,
		`{"filesystems":[{"source":"x","target":"/","fstype":"ext4","size":null,"used":0,"avail":0}]}`,
		`{"filesystems":[{"source":"x","target":"/","fstype":"ext4","size":100,"used":0,"avail":-1}]}`,
		`{"filesystems":[` + strings.Repeat(`{},`, 128) + `{}]}`,
		strings.Repeat(" ", (256<<10)+1),
	} {
		if _, err := ParseFileSystems([]byte(data)); err == nil {
			t.Fatal("接受缺失、无效或超限容量")
		}
	}
}
