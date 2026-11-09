package app

import (
	"encoding/json"

	"time"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	"github.com/Sanjeever/termquay/internal/store"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type ApplicationLockStatus struct {
	Available    bool `json:"available"`
	Locked       bool `json:"locked"`
	IdleMinutes  int  `json:"idle_minutes"`
	LockOnSystem bool `json:"lock_on_system"`
}

func init() { application.RegisterEvent[ApplicationLockStatus]("app:lock-changed") }

func (a *AppService) GetApplicationLock() (ApplicationLockStatus, error) {
	a.storeMu.Lock()
	status := ApplicationLockStatus{Locked: a.appLocked.Load(), LockOnSystem: true}
	if a.store != nil && a.sessionDir == "" {
		dir, err := storageDirectory()
		if err != nil {
			a.storeMu.Unlock()
			return status, err
		}
		status.Available, err = store.PasswordVaultExists(dir)
		if err != nil {
			a.storeMu.Unlock()
			return status, err
		}
		value, err := a.store.Setting("application_lock")
		if err != nil {
			a.storeMu.Unlock()
			return status, err
		}
		if value != "" {
			var config struct {
				IdleMinutes  int  `json:"idle_minutes"`
				LockOnSystem bool `json:"lock_on_system"`
			}
			if err := json.Unmarshal([]byte(value), &config); err != nil {
				a.storeMu.Unlock()
				return status, err
			}
			status.IdleMinutes, status.LockOnSystem = config.IdleMinutes, config.LockOnSystem
		}
	}
	a.storeMu.Unlock()
	a.lockMu.Lock()
	status.Locked = a.appLocked.Load()
	a.lockState = status
	a.lockMu.Unlock()
	return status, nil
}

func (a *AppService) ConfigureApplicationLock(idleMinutes int, lockOnSystem bool) (ApplicationLockStatus, error) {
	if a.appLocked.Load() {
		return ApplicationLockStatus{}, appmessage.New("backend:unlockTheApplicationFirst", "请先解锁应用")
	}
	if idleMinutes < 0 || idleMinutes > 120 {
		return ApplicationLockStatus{}, appmessage.New("backend:idleLockTimeoutMustBeFrom0To", "空闲锁定时间须为 0 至 120 分钟，0 表示关闭")
	}
	status, err := a.GetApplicationLock()
	if err != nil {
		return status, err
	}
	if !status.Available {
		return status, appmessage.New("backend:enableMasterPasswordStorageBeforeConfiguringApplicationLock", "请先启用主密码存储，再配置应用锁")
	}
	value, err := json.Marshal(struct {
		IdleMinutes  int  `json:"idle_minutes"`
		LockOnSystem bool `json:"lock_on_system"`
	}{idleMinutes, lockOnSystem})
	if err != nil {
		return status, err
	}
	a.storeMu.Lock()
	err = a.store.SetSetting("application_lock", string(value))
	a.storeMu.Unlock()
	if err != nil {
		return status, err
	}
	status, err = a.GetApplicationLock()
	if err == nil {
		a.TouchApplication()
		application.Get().Event.Emit("app:lock-changed", status)
	}
	return status, err
}

func (a *AppService) TouchApplication() {
	a.lockMu.Lock()
	defer a.lockMu.Unlock()
	if a.lockTimer != nil {
		a.lockTimer.Stop()
	}
	if a.appLocked.Load() || !a.lockState.Available || a.lockState.IdleMinutes == 0 {
		return
	}
	duration := time.Duration(a.lockState.IdleMinutes) * time.Minute
	a.lockDeadline = time.Now().Add(duration)
	a.lockTimer = time.AfterFunc(duration, func() {
		a.lockMu.Lock()
		status := a.lockState
		if !status.Available || a.appLocked.Load() || a.lockDeadline.IsZero() || time.Now().Before(a.lockDeadline) {
			a.lockMu.Unlock()
			return
		}
		a.appLocked.Store(true)
		status.Locked = true
		a.lockState = status
		a.lockDeadline = time.Time{}
		a.lockMu.Unlock()
		a.cancelAIWork()
		application.Get().Event.Emit("app:lock-changed", status)
	})
}

func (a *AppService) LockApplication() error {
	a.lockMu.Lock()
	status := a.lockState
	if !status.Available {
		a.lockMu.Unlock()
		return appmessage.New("backend:applicationLockRequiresUnlockedMasterPasswordStorage", "应用锁需要已解锁的主密码存储")
	}
	if a.lockTimer != nil {
		a.lockTimer.Stop()
	}
	if a.appLocked.Swap(true) {
		a.lockMu.Unlock()
		return nil
	}
	status.Locked = true
	a.lockState = status
	a.lockDeadline = time.Time{}
	a.lockMu.Unlock()
	a.cancelAIWork()
	application.Get().Event.Emit("app:lock-changed", status)
	return nil
}

func (a *AppService) UnlockApplication(password string) (ApplicationLockStatus, error) {
	if !a.lockAuthMu.TryLock() {
		return ApplicationLockStatus{}, appmessage.New("backend:masterPasswordVerificationInProgressTryAgainShortly", "正在验证主密码，请稍后重试")
	}
	defer a.lockAuthMu.Unlock()
	if !a.appLocked.Load() {
		return a.GetApplicationLock()
	}
	a.storeMu.Lock()
	var err error
	if a.store == nil || a.sessionDir != "" {
		err = appmessage.New("backend:masterPasswordStorageUnavailable", "主密码存储不可用")
	} else {
		err = a.store.VerifyVaultPassword(password)
	}
	a.storeMu.Unlock()
	if err != nil {
		return ApplicationLockStatus{}, err
	}
	a.appLocked.Store(false)
	status, err := a.GetApplicationLock()
	if err == nil {
		a.TouchApplication()
		application.Get().Event.Emit("app:lock-changed", status)
	}
	return status, err
}

func (a *AppService) lockForSystem() {
	a.lockMu.Lock()
	enabled := a.lockState.Available && a.lockState.LockOnSystem
	a.lockMu.Unlock()
	if enabled {
		_ = a.LockApplication()
	}
}

func (a *AppService) applicationInputAllowed() bool { return !a.appLocked.Load() }
