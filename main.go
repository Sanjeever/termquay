package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	service := NewAppService()
	app := application.New(application.Options{
		Name: "TermQuay", Description: "栈桥远程连接工作台",
		ShouldQuit: service.canQuit,
		Services:   []application.Service{application.NewService(service)},
		Assets:     application.AssetOptions{Handler: application.AssetFileServerFS(assets)},
		Mac:        application.MacOptions{ApplicationShouldTerminateAfterLastWindowClosed: true},
	})
	app.HandleStream("terminal", service.handleTerminal)
	app.HandleStream("workspace", service.handleWorkspace)
	window := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title: "TermQuay · 栈桥", Width: 1280, Height: 820, MinWidth: 900, MinHeight: 600,
		BackgroundColour: application.NewRGB(16, 18, 22), URL: "/",
	})
	window.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		if !service.canQuit() {
			event.Cancel()
		}
	})
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
