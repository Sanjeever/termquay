package app

import (
	"encoding/json"
	"errors"

	"github.com/Sanjeever/termquay/internal/ai"
)

type AISettings struct {
	Enabled     bool   `json:"enabled"`
	Protocol    string `json:"protocol"`
	Endpoint    string `json:"endpoint"`
	Model       string `json:"model"`
	HasAPIKey   bool   `json:"has_api_key"`
	ConfirmExec bool   `json:"confirm_exec"`
}

type AISettingsUpdate struct {
	Enabled      bool   `json:"enabled"`
	Protocol     string `json:"protocol"`
	Endpoint     string `json:"endpoint"`
	Model        string `json:"model"`
	APIKeyAction string `json:"api_key_action"`
	APIKey       string `json:"api_key"`
	ConfirmExec  bool   `json:"confirm_exec"`
}

func (a *AppService) aiConfig() (ai.Config, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	return a.aiConfigLocked()
}

func (a *AppService) aiConfigLocked() (ai.Config, error) {
	c := ai.DefaultConfig()
	if a.appLocked.Load() {
		return c, errors.New("应用已锁定")
	}
	if err := a.openStorage(); err != nil {
		return c, err
	}
	value, err := a.store.SecretSetting("ai_config")
	if err == nil && value != "" {
		err = json.Unmarshal([]byte(value), &c)
	}
	return c, err
}

func aiSettingsView(c ai.Config) AISettings {
	return AISettings{Enabled: c.Enabled, Protocol: c.Protocol, Endpoint: c.Endpoint, Model: c.Model, HasAPIKey: c.APIKey != "", ConfirmExec: c.ConfirmExec}
}

func (a *AppService) GetAISettings() (AISettings, error) {
	c, err := a.aiConfig()
	return aiSettingsView(c), err
}

func (a *AppService) SaveAISettings(update AISettingsUpdate) (AISettings, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	c, err := a.aiConfigLocked()
	if err != nil {
		return AISettings{}, err
	}
	c.Enabled, c.Protocol, c.Endpoint, c.Model, c.ConfirmExec = update.Enabled, update.Protocol, update.Endpoint, update.Model, update.ConfirmExec
	switch update.APIKeyAction {
	case "keep":
	case "replace":
		c.APIKey = update.APIKey
	case "clear":
		c.APIKey = ""
	default:
		return AISettings{}, errors.New("API Key 更新方式无效")
	}
	if err := c.Validate(); err != nil {
		return AISettings{}, err
	}
	b, err := json.Marshal(c)
	if err != nil {
		return AISettings{}, err
	}
	if err := a.store.SetSecretSetting("ai_config", string(b)); err != nil {
		return AISettings{}, err
	}
	return aiSettingsView(c), nil
}
