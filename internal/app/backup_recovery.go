package app

import (
	"context"
	"errors"
	"io"
	"os"
	"strings"
	"time"

	"filippo.io/age"
	"github.com/Sanjeever/termquay/internal/backup"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type BackupRecoveryKeyExport struct {
	Recipient string `json:"recipient"`
	Path      string `json:"path"`
}

func (a *AppService) GetBackupRecoveryRecipient() (string, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return "", err
	}
	return a.store.Setting("backup_recovery_recipient")
}

func (a *AppService) SetBackupRecoveryRecipient(recipient string) error {
	if recipient != "" {
		if _, err := age.ParseX25519Recipient(recipient); err != nil {
			return errors.New("恢复公钥格式无效")
		}
	}
	a.backupMu.Lock()
	a.storeMu.Lock()
	err := a.openStorage()
	if err == nil {
		err = a.store.SetSetting("backup_recovery_recipient", recipient)
	}
	a.storeMu.Unlock()
	a.backupMu.Unlock()
	if err == nil {
		a.queueAutomaticBackup()
	}
	return err
}

func (a *AppService) ExportBackupRecoveryKey() (BackupRecoveryKeyExport, error) {
	key, err := age.GenerateX25519Identity()
	if err != nil {
		return BackupRecoveryKeyExport{}, err
	}
	filename, err := application.Get().Dialog.SaveFile().SetMessage(nativeText("Save backup recovery key offline. This file decrypts corresponding backups.", "离线保存备份恢复密钥，持有此文件可解密对应备份")).SetFilename("termquay-recovery-" + time.Now().UTC().Format("20060102T150405.000000000Z") + ".agekey").PromptForSingleSelection()
	if err != nil || filename == "" {
		return BackupRecoveryKeyExport{}, err
	}
	secret := []byte(key.String() + "\n")
	defer clear(secret)
	if err := writeRecoveryKey(filename, secret); err != nil {
		return BackupRecoveryKeyExport{}, err
	}
	return BackupRecoveryKeyExport{Recipient: key.Recipient().String(), Path: filename}, nil
}

func writeRecoveryKey(filename string, secret []byte) error {
	file, err := os.OpenFile(filename, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if errors.Is(err, os.ErrExist) {
		return errors.New("恢复密钥文件已存在，请另存并保留旧密钥供历史备份使用")
	}
	if err != nil {
		return err
	}
	_, err = file.Write(secret)
	if err == nil {
		err = file.Sync()
	}
	err = errors.Join(err, file.Close())
	if err != nil {
		return errors.Join(err, os.Remove(filename))
	}
	return nil
}

func selectBackupRecoveryKey() (string, error) {
	filename, err := application.Get().Dialog.OpenFile().SetTitle(nativeText("Select backup recovery key file", "选择备份恢复密钥文件")).PromptForSingleSelection()
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
	if !info.Mode().IsRegular() || info.Size() > 4096 {
		return "", errors.New("恢复密钥须为不超过 4096 字节的普通文件")
	}
	data, err := io.ReadAll(io.LimitReader(file, 4097))
	if err != nil {
		return "", err
	}
	defer clear(data)
	if len(data) > 4096 {
		return "", errors.New("恢复密钥超过长度限制")
	}
	secret := string(data)
	if _, err := backup.RecoveryRecipient(secret); err != nil {
		return "", err
	}
	return secret, nil
}

func (a *AppService) SelectBackupRecoveryRecipient() (string, error) {
	secret, err := selectBackupRecoveryKey()
	if err != nil || secret == "" {
		return "", err
	}
	return backup.RecoveryRecipient(secret)
}

func (a *AppService) PreviewSavedRestoreWithRecovery(ctx context.Context, path, secret string) (RestorePreview, error) {
	var err error
	if strings.TrimSpace(secret) == "" {
		secret, err = selectBackupRecoveryKey()
		if err != nil || secret == "" {
			return RestorePreview{}, err
		}
	}
	recipient, err := backup.RecoveryRecipient(secret)
	if err != nil {
		return RestorePreview{}, err
	}
	a.backupMu.Lock()
	defer a.backupMu.Unlock()
	a.preview = nil
	config, err := a.savedBackupConfig()
	if err != nil {
		return RestorePreview{}, err
	}
	data, err := config.Options.Read(ctx, path)
	if err != nil {
		return RestorePreview{}, err
	}
	snapshot, err := backup.DecryptWithRecovery(data, "", secret)
	if err != nil {
		return RestorePreview{}, err
	}
	preview, err := a.prepareRestore(snapshot)
	if err == nil {
		a.preview.recoveryRecipient = recipient
	}
	return preview, err
}

func (a *AppService) PreviewLocalRestoreWithRecovery(secret string) (RestorePreview, error) {
	var err error
	if strings.TrimSpace(secret) == "" {
		secret, err = selectBackupRecoveryKey()
		if err != nil || secret == "" {
			return RestorePreview{}, err
		}
	}
	return a.previewLocalRestore("", secret)
}
