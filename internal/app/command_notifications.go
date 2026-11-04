package app

import (
	"context"
	"errors"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

func (a *AppService) EnableCommandNotification(ctx context.Context) error {
	a.notificationMu.Lock()
	defer a.notificationMu.Unlock()
	if a.notifications == nil {
		service := notifications.New()
		if err := service.ServiceStartup(ctx, application.ServiceOptions{}); err != nil {
			return err
		}
		service.OnNotificationResponse(func(result notifications.NotificationResult) {
			if result.Error != nil || !strings.HasPrefix(result.Response.ID, "command:") {
				return
			}
			app := application.Get()
			if window, ok := app.Window.GetByName("workbench"); ok {
				window.Show()
				window.Focus()
			}
			app.Event.Emit("terminal:notification-activated", strings.TrimPrefix(result.Response.ID, "command:"))
		})
		a.notifications = service
	}
	allowed, err := a.notifications.RequestNotificationAuthorization()
	if err != nil {
		return err
	}
	if !allowed {
		return errors.New("系统未授权通知，请在系统设置中允许 TermQuay 发送通知")
	}
	return ctx.Err()
}

func (a *AppService) NotifyCommandFinished(id string, failed bool) error {
	a.notificationMu.Lock()
	defer a.notificationMu.Unlock()
	if a.notifications == nil {
		return errors.New("尚未启用命令完成提醒")
	}
	a.mu.Lock()
	_, remote := a.terminals[id]
	_, local := a.locals[id]
	_, container := a.containerTerminals[id]
	a.mu.Unlock()
	if !remote && !local && !container {
		return errors.New("终端已关闭")
	}
	app := application.Get()
	if window, ok := app.Window.GetByName("workbench"); !ok || window.IsFocused() {
		return nil
	}
	body := "命令已完成，点击返回终端。"
	if failed {
		body = "命令执行失败，点击返回终端。"
	}
	return a.notifications.SendNotification(notifications.NotificationOptions{ID: "command:" + id, Title: "TermQuay", Body: body})
}

func (a *AppService) closeNotifications() error {
	a.notificationMu.Lock()
	defer a.notificationMu.Unlock()
	if a.notifications == nil {
		return nil
	}
	return a.notifications.ServiceShutdown()
}
