package app

import (
	"errors"
	"sync/atomic"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Native UI starts in English before the WebView sends its saved preference.
var nativeChinese atomic.Bool

func (a *AppService) SetLanguage(language string) error {
	if language != "en" && language != "zh-CN" {
		return errors.New("Unsupported interface language")
	}
	nativeChinese.Store(language == "zh-CN")
	if app := application.Get(); app != nil {
		app.Event.Emit("app:language", language)
	}
	return nil
}

func nativeText(english, chinese string) string {
	if nativeChinese.Load() {
		return chinese
	}
	return english
}
