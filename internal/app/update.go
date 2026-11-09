package app

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	updates "github.com/Sanjeever/termquay/internal/update"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/updater"
)

type UpdateStatus struct {
	Build        BuildInfo              `json:"build"`
	State        string                 `json:"state"`
	Enabled      bool                   `json:"enabled"`
	Busy         bool                   `json:"busy"`
	Version      string                 `json:"version"`
	Notes        string                 `json:"notes"`
	URL          string                 `json:"url"`
	CheckedAt    string                 `json:"checked_at"`
	Downloaded   int64                  `json:"downloaded"`
	Total        int64                  `json:"total"`
	Error        string                 `json:"error"`
	ErrorMessage *appmessage.Descriptor `json:"error_message,omitempty"`
}

func (a *AppService) initUpdater(app *application.App) error {
	provider, err := updates.New(&http.Client{})
	if err != nil {
		return err
	}
	a.updateContext, a.updateStop = context.WithCancel(context.Background())
	a.updateWake = make(chan struct{}, 1)
	a.updateEngine = app.Updater
	a.updateStatus.Build = a.build
	if err := app.Updater.Init(updater.Config{CurrentVersion: a.build.Version, Providers: []updater.Provider{provider}, Window: updater.WindowNone}); err != nil {
		return err
	}
	for _, name := range []string{updater.EventCheckStarted, updater.EventDownloadStarted, updater.EventVerifying, updater.EventInstalling, updater.EventUpdateReady} {
		app.Event.On(name, func(_ *application.CustomEvent) { a.publishUpdate() })
	}
	app.Event.On(updater.EventDownloadProgress, func(event *application.CustomEvent) {
		progress, ok := event.Data.(updater.Progress)
		if !ok {
			return
		}
		a.updateMu.Lock()
		a.updateStatus.Downloaded, a.updateStatus.Total = progress.Written, progress.Total
		a.updateMu.Unlock()
		a.publishUpdate()
	})
	return nil
}

func (a *AppService) GetUpdateStatus() UpdateStatus {
	a.updateMu.Lock()
	defer a.updateMu.Unlock()
	status := a.updateStatus
	status.Busy = a.updateBusy
	if a.updateEngine != nil {
		status.State = string(a.updateEngine.State())
	}
	return status
}

func (a *AppService) publishUpdate() {
	application.Get().Event.Emit("update:changed", a.GetUpdateStatus())
}

func (a *AppService) StartUpdates() error {
	a.updateMu.Lock()
	defer a.updateMu.Unlock()
	if a.updateStarted || a.updateStopped || a.updateEngine == nil {
		return nil
	}
	a.storeMu.Lock()
	err := a.openStorage()
	disabled := ""
	if err == nil {
		disabled, err = a.store.Setting("disable_update_check")
	}
	a.storeMu.Unlock()
	if err != nil {
		return err
	}
	a.updateStatus.Enabled = disabled != "true" && !a.build.Development
	a.updateStarted = true
	if a.build.Development {
		return nil
	}
	a.updateWorkers.Add(1)
	go a.updateLoop()
	return nil
}

func (a *AppService) SetUpdateCheck(enabled bool) error {
	a.updateMu.Lock()
	defer a.updateMu.Unlock()
	if a.build.Development || a.updateStopped {
		return appmessage.New("backend:thisBuildCannotEnableAutomaticUpdates", "当前构建不能启用自动更新")
	}
	a.storeMu.Lock()
	err := a.openStorage()
	if err == nil {
		value := "true"
		if enabled {
			value = "false"
		}
		err = a.store.SetSetting("disable_update_check", value)
	}
	a.storeMu.Unlock()
	if err != nil {
		return err
	}
	a.updateStatus.Enabled = enabled
	select {
	case a.updateWake <- struct{}{}:
	default:
	}
	return nil
}

func (a *AppService) updateLoop() {
	defer a.updateWorkers.Done()
	timer := time.NewTimer(20 * time.Second)
	defer timer.Stop()
	for {
		select {
		case <-a.updateContext.Done():
			return
		case <-a.updateWake:
			timer.Reset(20 * time.Second)
		case <-timer.C:
			status := a.GetUpdateStatus()
			if status.Enabled && !status.Busy && status.State != string(updater.StateReady) {
				_ = a.CheckUpdate(a.updateContext)
			}
			timer.Reset(24 * time.Hour)
		}
	}
}

func (a *AppService) beginUpdate(ctx context.Context) (context.Context, func(), error) {
	a.updateMu.Lock()
	defer a.updateMu.Unlock()
	if a.build.Development || a.updateEngine == nil {
		return nil, nil, appmessage.New("backend:developmentBuildsDoNotCheckForOrInstall", "开发构建不检查或安装更新，请查看 GitHub 发布页面")
	}
	if a.updateStopped || a.updateBusy {
		return nil, nil, appmessage.New("backend:anUpdateIsInProgressOrTheApplication", "更新任务正在进行或应用正在退出")
	}
	ctx, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(a.updateContext, cancel)
	a.updateCancel = cancel
	a.updateBusy = true
	a.updateStatus.Error = ""
	a.updateStatus.ErrorMessage = nil
	a.updateWorkers.Add(1)
	return ctx, func() {
		stop()
		cancel()
		a.updateMu.Lock()
		a.updateCancel = nil
		a.updateBusy = false
		a.updateMu.Unlock()
		a.publishUpdate()
		a.updateWorkers.Done()
	}, nil
}

func (a *AppService) CheckUpdate(ctx context.Context) error {
	ctx, finish, err := a.beginUpdate(ctx)
	if err != nil {
		return err
	}
	defer finish()
	if a.updateEngine.State() == updater.StateReady {
		return appmessage.New("backend:updateDownloadedRestartTheApplicationFirst", "更新已下载，请先重启应用")
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	release, err := a.updateEngine.Check(ctx)
	a.updateMu.Lock()
	defer a.updateMu.Unlock()
	a.updateStatus.Version, a.updateStatus.Notes, a.updateStatus.URL = "", "", ""
	if err != nil {
		a.updateStatus.Error = err.Error()
		a.updateStatus.ErrorMessage = appmessage.Describe(err)
		return err
	}
	a.updateStatus.CheckedAt = time.Now().UTC().Format(time.RFC3339)
	if release != nil {
		a.updateStatus.Version, a.updateStatus.Notes = release.Version, release.Notes
		a.updateStatus.URL, _ = release.Metadata["github.release.htmlURL"].(string)
		a.updateStatus.Total = release.Artifact.Size
	}
	return nil
}

func (a *AppService) DownloadUpdate(ctx context.Context) error {
	ctx, finish, err := a.beginUpdate(ctx)
	if err != nil {
		return err
	}
	defer finish()
	ctx, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()
	status := a.GetUpdateStatus()
	if status.Version == "" || status.State == string(updater.StateReady) {
		return appmessage.New("backend:noUpdateAvailableToDownload", "没有可下载的更新")
	}
	a.updateMu.Lock()
	a.updateStatus.Downloaded = 0
	a.updateMu.Unlock()
	err = a.updateEngine.DownloadAndInstall(ctx)
	if errors.Is(err, context.Canceled) {
		return nil
	}
	if err != nil {
		a.updateMu.Lock()
		a.updateStatus.Error = err.Error()
		a.updateStatus.ErrorMessage = appmessage.Describe(err)
		a.updateMu.Unlock()
	}
	return err
}

func (a *AppService) CancelUpdate() {
	a.updateMu.Lock()
	defer a.updateMu.Unlock()
	if a.updateCancel != nil {
		a.updateCancel()
	}
}

func (a *AppService) RestartForUpdate(ctx context.Context) error {
	a.updateMu.Lock()
	if a.build.Development || a.updateStopped || a.updateBusy || a.updateEngine == nil || a.updateEngine.State() != updater.StateReady {
		a.updateMu.Unlock()
		return appmessage.New("backend:updateIsNotReadyYet", "更新尚未准备好")
	}
	a.updateBusy = true
	a.updateRestarting = true
	a.updateMu.Unlock()
	a.mu.Lock()
	a.allowQuit = true
	a.mu.Unlock()
	// 前端已完成文件确认及本地持久化，之后才交接更新辅助进程。
	if err := a.updateEngine.Restart(ctx); err != nil {
		a.mu.Lock()
		a.allowQuit = false
		a.mu.Unlock()
		a.updateMu.Lock()
		a.updateBusy = false
		a.updateRestarting = false
		a.updateMu.Unlock()
		return err
	}
	return nil
}

func (a *AppService) stopUpdates() error {
	a.updateMu.Lock()
	a.updateStopped = true
	if a.updateStop != nil {
		a.updateStop()
	}
	a.updateMu.Unlock()
	a.updateWorkers.Wait()
	a.updateMu.Lock()
	defer a.updateMu.Unlock()
	if a.updateEngine != nil && !a.updateRestarting {
		if path := a.updateEngine.DownloadedPath(); path != "" {
			directory := filepath.Dir(path)
			if !strings.HasPrefix(filepath.Base(directory), "wails-update-") {
				return appmessage.New("backend:invalidUpdateStagingDirectory", "更新暂存目录无效")
			}
			return os.RemoveAll(directory)
		}
	}
	return nil
}
