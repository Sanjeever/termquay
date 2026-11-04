package app

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/Sanjeever/termquay/internal/backup"
)

type AutomaticBackupStatus struct {
	Enabled     bool   `json:"enabled"`
	Running     bool   `json:"running"`
	Pending     bool   `json:"pending"`
	URL         string `json:"url"`
	LastSuccess string `json:"last_success"`
	Error       string `json:"error"`
	FailureID   uint64 `json:"failure_id"`
}

type automaticBackupConfig struct {
	Options   backup.WebDAVOptions `json:"options"`
	Password  string               `json:"password"`
	Selection BackupSelection      `json:"selection"`
	Paused    bool                 `json:"paused,omitempty"`
}

func (a *AppService) startAutomaticBackupLocked(config *automaticBackupConfig) {
	a.automaticConfig = config
	a.automaticLoaded = true
	a.automaticStatus.Enabled = config != nil && !config.Paused
	a.automaticStatus.Error = ""
	if a.automaticTaskCancel != nil {
		a.automaticTaskCancel()
	}
	if config == nil || config.Paused {
		a.automaticStatus.Pending = false
		a.automaticStatus.URL = ""
		return
	}
	a.automaticStatus.URL = config.Options.URL
	if a.automaticSignal == nil {
		a.automaticSignal = make(chan struct{}, 1)
		a.automaticDone = make(chan struct{})
		ctx, cancel := context.WithCancel(context.Background())
		a.automaticStop = cancel
		go a.runAutomaticBackup(ctx)
	}
	a.automaticStatus.Pending = true
	select {
	case a.automaticSignal <- struct{}{}:
	default:
	}
}

func (a *AppService) queueAutomaticBackup() {
	a.automaticMu.Lock()
	defer a.automaticMu.Unlock()
	if a.automaticConfig == nil || a.automaticConfig.Paused {
		return
	}
	a.automaticStatus.Pending = true
	select {
	case a.automaticSignal <- struct{}{}:
	default:
	}
}

func (a *AppService) GetAutomaticBackupStatus() (AutomaticBackupStatus, error) {
	a.automaticMu.Lock()
	loaded := a.automaticLoaded
	a.automaticMu.Unlock()
	if !loaded {
		a.storeMu.Lock()
		if err := a.openStorage(); err != nil {
			a.storeMu.Unlock()
			return AutomaticBackupStatus{}, err
		}
		value, err := a.store.SecretSetting("automatic_backup")
		last, lastErr := a.store.Setting("automatic_backup_last_success")
		a.storeMu.Unlock()
		if err != nil {
			return AutomaticBackupStatus{}, err
		}
		if lastErr != nil {
			return AutomaticBackupStatus{}, lastErr
		}
		var config *automaticBackupConfig
		if value != "" {
			config = &automaticBackupConfig{}
			if err := json.Unmarshal([]byte(value), config); err != nil {
				return AutomaticBackupStatus{}, err
			}
		}
		a.automaticMu.Lock()
		if !a.automaticLoaded {
			a.automaticStatus.LastSuccess = last
			a.startAutomaticBackupLocked(config)
		}
		a.automaticMu.Unlock()
	}
	a.automaticMu.Lock()
	defer a.automaticMu.Unlock()
	return a.automaticStatus, nil
}

func (a *AppService) EnableAutomaticBackup(ctx context.Context, options backup.WebDAVOptions, password string, selection BackupSelection) error {
	if password == "" {
		return errors.New("独立备份密码不能为空")
	}
	if len(selection.ConnectionIDs) > 0 {
		return errors.New("自动备份覆盖全部连接，请取消连接筛选")
	}
	if err := options.Check(ctx); err != nil {
		return err
	}
	config := &automaticBackupConfig{Options: options, Password: password, Selection: selection}
	a.backupMu.Lock()
	defer a.backupMu.Unlock()
	return a.saveBackupConfig(config)
}

func (a *AppService) DisableAutomaticBackup() error {
	a.backupMu.Lock()
	defer a.backupMu.Unlock()
	config, err := a.savedBackupConfig()
	if err != nil {
		return err
	}
	config.Paused = true
	return a.saveBackupConfig(&config)
}

func (a *AppService) runAutomaticBackup(ctx context.Context) {
	defer close(a.automaticDone)
	for {
		select {
		case <-ctx.Done():
			return
		case <-a.automaticSignal:
		}
		timer := time.NewTimer(5 * time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
		select {
		case <-a.automaticSignal:
		default:
		}
		a.automaticMu.Lock()
		config := a.automaticConfig
		if config == nil || config.Paused {
			a.automaticMu.Unlock()
			continue
		}
		taskCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
		a.automaticTaskCancel = cancel
		a.automaticStatus.Running, a.automaticStatus.Pending = true, false
		a.automaticMu.Unlock()
		_, err := a.BackupWebDAVWithSelection(taskCtx, config.Options, config.Password, config.Selection)
		cancel()
		a.automaticMu.Lock()
		a.automaticTaskCancel = nil
		a.automaticStatus.Running = false
		last := ""
		if a.automaticConfig == config {
			if err != nil {
				a.automaticStatus.Error = err.Error()
				a.automaticStatus.FailureID++
			} else {
				last = time.Now().UTC().Format(time.RFC3339Nano)
				a.automaticStatus.LastSuccess = last
				a.automaticStatus.Error = ""
			}
		}
		a.automaticMu.Unlock()
		if last != "" {
			a.storeMu.Lock()
			err := a.store.SetSetting("automatic_backup_last_success", last)
			a.storeMu.Unlock()
			if err != nil {
				a.automaticMu.Lock()
				a.automaticStatus.Error = "快照已发布，但成功时间保存失败：" + err.Error()
				a.automaticStatus.FailureID++
				a.automaticMu.Unlock()
			}
		}
	}
}

func (a *AppService) stopAutomaticBackup() {
	a.automaticMu.Lock()
	stop, done := a.automaticStop, a.automaticDone
	a.automaticConfig = nil
	if stop != nil {
		stop()
	}
	a.automaticMu.Unlock()
	if done != nil {
		<-done
	}
}
