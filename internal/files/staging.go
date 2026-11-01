package files

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"path"

	"github.com/pkg/sftp"
)

func CreateStaging(client *sftp.Client, parent string) (string, error) {
	info, err := client.Stat(parent)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", errors.New("临时文件的父路径不是目录")
	}
	if info.Mode().Perm()&0022 != 0 && info.Mode()&os.ModeSticky == 0 {
		return "", errors.New("目标目录允许其他用户改写，无法安全创建临时文件")
	}
	var token [16]byte
	if _, err = rand.Read(token[:]); err != nil {
		return "", err
	}
	dir := path.Join(parent, ".termquay-"+hex.EncodeToString(token[:]))
	if err = client.Mkdir(dir); err != nil {
		return "", err
	}
	if err = client.Chmod(dir, 0700); err != nil {
		return "", errors.Join(err, client.RemoveDirectory(dir))
	}
	return dir, nil
}

func RemoveStaging(client *sftp.Client, dir string) error {
	err := client.Remove(path.Join(dir, "data"))
	if errors.Is(err, os.ErrNotExist) {
		err = nil
	}
	return errors.Join(err, client.RemoveDirectory(dir))
}
