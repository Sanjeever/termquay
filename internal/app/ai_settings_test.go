package app

import (
	"encoding/json"
	"strings"
	"testing"

	"context"
	"github.com/Sanjeever/termquay/internal/localapi"
)

func TestAISettingsSecretsAndIndependentCLI(t *testing.T) {
	a := NewAppService(BuildInfo{}, nil)
	if err := a.UseSessionStorage(); err != nil {
		t.Fatal(err)
	}
	defer a.ServiceShutdown()
	view, err := a.GetAISettings()
	if err != nil || view.Enabled || !view.ConfirmExec || view.RequestTimeoutMinutes != 10 {
		t.Fatalf("默认值错误: %+v %v", view, err)
	}
	u := AISettingsUpdate{Protocol: "responses", Endpoint: "https://example.invalid/v1/responses", Model: "test", APIKeyAction: "replace", APIKey: "synthetic-api-key", ConfirmExec: true}
	for _, cli := range []bool{false, true} {
		if err := a.SaveCLIAccess(cli); err != nil {
			t.Fatal(err)
		}
		for _, enabled := range []bool{false, true} {
			u.Enabled = enabled
			view, err = a.SaveAISettings(u)
			if err != nil {
				t.Fatal(err)
			}
			b, _ := json.Marshal(view)
			if strings.Contains(string(b), u.APIKey) || !view.HasAPIKey {
				t.Fatal("泄露 Key 或缺少状态")
			}
			actual, err := a.GetCLIAccess()
			if err != nil || actual != cli {
				t.Fatal("AI 改变 CLI 授权")
			}
			response := a.handleCLI(context.Background(), localapi.Request{Operation: "connection.list"})
			if cli && response.Error != nil || !cli && response.Error == nil {
				t.Fatal("CLI 与 AI 开关耦合")
			}
		}
	}
	u.APIKeyAction = "keep"
	u.APIKey = "ignored"
	if _, err := a.SaveAISettings(u); err != nil {
		t.Fatal(err)
	}
	c, err := a.aiConfig()
	if err != nil || c.APIKey != "synthetic-api-key" {
		t.Fatal("保留 Key 失败")
	}
	u.APIKeyAction = "clear"
	if view, err := a.SaveAISettings(u); err != nil || view.HasAPIKey {
		t.Fatal("清除 Key 失败")
	}
	stored, err := a.store.Setting("ai_config")
	if err != nil || strings.Contains(stored, "example.invalid") {
		t.Fatal("配置未加密")
	}
	a.appLocked.Store(true)
	if _, err := a.GetAISettings(); err == nil {
		t.Fatal("锁定可读 AI 配置")
	}
}

func TestAIRequestTimeoutSettingsCompatibility(t *testing.T) {
	a := NewAppService(BuildInfo{}, nil)
	if err := a.UseSessionStorage(); err != nil {
		t.Fatal(err)
	}
	defer a.ServiceShutdown()
	if err := a.store.SetSecretSetting("ai_config", `{"enabled":false,"protocol":"responses","confirm_exec":true}`); err != nil {
		t.Fatal(err)
	}
	view, err := a.GetAISettings()
	if err != nil || view.RequestTimeoutMinutes != 10 {
		t.Fatal("旧配置未采用默认等待时间")
	}
	minutes := 20
	u := AISettingsUpdate{Protocol: "responses", APIKeyAction: "keep", ConfirmExec: true, RequestTimeoutMinutes: &minutes}
	view, err = a.SaveAISettings(u)
	if err != nil || view.RequestTimeoutMinutes != 20 {
		t.Fatal("等待时间未保存")
	}
	u.RequestTimeoutMinutes = nil
	view, err = a.SaveAISettings(u)
	if err != nil || view.RequestTimeoutMinutes != 20 {
		t.Fatal("省略字段覆盖了已有等待时间")
	}
	minutes = 0
	u.RequestTimeoutMinutes = &minutes
	if _, err := a.SaveAISettings(u); err == nil {
		t.Fatal("接受零分钟等待时间")
	}
}
