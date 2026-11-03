package main

import (
	"embed"
	"log"
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/appicon.png build/darwin/appicon.png
var appIcons embed.FS

func main() {
	iconPath := "build/appicon.png"
	if runtime.GOOS == "darwin" {
		iconPath = "build/darwin/appicon.png"
	}
	appIcon, err := appIcons.ReadFile(iconPath)
	if err != nil {
		log.Fatal(err)
	}
	service := NewAppService()
	app := application.New(application.Options{
		Name: "TermQuay", Description: "栈桥远程连接工作台",
		Icon:       appIcon,
		ShouldQuit: service.canQuit,
		Services:   []application.Service{application.NewService(service)},
		Assets:     application.AssetOptions{Handler: application.AssetFileServerFS(assets)},
		Mac:        application.MacOptions{ApplicationShouldTerminateAfterLastWindowClosed: true},
	})
	app.HandleStream("terminal", service.handleTerminal)
	app.HandleStream("workspace", service.handleWorkspace)
	app.HandleStream("local-terminal", service.handleLocalTerminal)
	window := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title: "TermQuay · 栈桥", Width: 1280, Height: 820, MinWidth: 900, MinHeight: 600,
		BackgroundColour: application.NewRGB(16, 18, 22), URL: "/",
		EnableFileDrop: true,
	})
	window.OnWindowEvent(events.Common.WindowFilesDropped, func(event *application.WindowEvent) {
		details := event.Context().DropTargetDetails()
		if details == nil {
			return
		}
		id := details.Attributes["data-workspace-id"]
		directory := details.Attributes["data-remote-directory"]
		result, err := service.uploadFiles(id, directory, event.Context().DroppedFiles(), false)
		message := ""
		if err != nil {
			message = err.Error()
		}
		app.Event.Emit("files:upload-result", UploadDropResult{Workspace: id, Result: result, Error: message})
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
