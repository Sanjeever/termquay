package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	service := NewAppService()
	app := application.New(application.Options{
		Name: "TermQuay", Description: "栈桥远程连接工作台",
		Services: []application.Service{application.NewService(service)},
		Assets:   application.AssetOptions{Handler: application.AssetFileServerFS(assets)},
		Mac:      application.MacOptions{ApplicationShouldTerminateAfterLastWindowClosed: true},
	})
	app.HandleStream("terminal", service.handleTerminal)
	app.HandleStream("workspace", service.handleWorkspace)
	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title: "TermQuay · 栈桥", Width: 1280, Height: 820, MinWidth: 900, MinHeight: 600,
		BackgroundColour: application.NewRGB(18, 20, 24), URL: "/",
	})
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
