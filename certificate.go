package main

import (
	"errors"
	"io"
	"os"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/crypto/ssh"
)

func (a *AppService) SelectSSHCertificate() (string, error) {
	filename, err := application.Get().Dialog.OpenFile().SetTitle("选择 SSH 用户证书").PromptForSingleSelection()
	if err != nil || filename == "" {
		return "", err
	}
	file, err := os.Open(filename)
	if err != nil {
		return "", err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() || info.Size() > 64<<10 {
		return "", errors.New("用户证书须为 64 KiB 内的普通文件")
	}
	data, err := io.ReadAll(io.LimitReader(file, (64<<10)+1))
	if err != nil {
		return "", err
	}
	if len(data) > 64<<10 {
		return "", errors.New("用户证书超过 64 KiB")
	}
	key, _, _, rest, err := ssh.ParseAuthorizedKey(data)
	if err != nil || strings.TrimSpace(string(rest)) != "" {
		return "", errors.New("文件不是单个 OpenSSH 用户证书")
	}
	certificate, ok := key.(*ssh.Certificate)
	if !ok || certificate.CertType != ssh.UserCert {
		return "", errors.New("文件不是 SSH 用户证书")
	}
	return string(data), nil
}
