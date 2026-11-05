package app

import (
	"errors"
	"strconv"
)

func (a *AppService) GetCLIAccess() (bool, error) {
	if a.appLocked.Load() {
		return false, errors.New("应用已锁定")
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return false, err
	}
	value, err := a.store.Setting("cli_access")
	if err != nil {
		return false, err
	}
	if value == "" {
		return false, nil
	}
	return strconv.ParseBool(value)
}

func (a *AppService) SaveCLIAccess(enabled bool) error {
	if a.appLocked.Load() {
		return errors.New("应用已锁定")
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return err
	}
	return a.store.SetSetting("cli_access", strconv.FormatBool(enabled))
}
