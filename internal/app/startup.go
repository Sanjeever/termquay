package app

import (
	"io/fs"
	"runtime"

	"github.com/Sanjeever/termquay/internal/localapi"
	appmessage "github.com/Sanjeever/termquay/internal/message"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

func Run(assets fs.FS, appIcons fs.ReadFileFS, build BuildInfo, licenses fs.ReadFileFS) error {
	iconPath := "build/appicon.png"
	if runtime.GOOS == "darwin" {
		iconPath = "build/darwin/appicon.png"
	}
	appIcon, err := appIcons.ReadFile(iconPath)
	if err != nil {
		return err
	}
	service := NewAppService(build, licenses)
	app := application.New(application.Options{
		Name: "TermQuay", Description: "TermQuay 远程连接工作台",
		Icon:       appIcon,
		ShouldQuit: service.canQuit,
		Services:   []application.Service{application.NewServiceWithOptions(service, application.ServiceOptions{MarshalError: marshalServiceError})},
		Assets:     application.AssetOptions{Handler: service.imageAssetHandler(application.AssetFileServerFS(assets))},
		Mac:        application.MacOptions{ApplicationShouldTerminateAfterLastWindowClosed: true},
	})
	cliServer, err := localapi.Listen(service.handleCLI)
	if err != nil {
		return err
	}
	defer cliServer.Close()
	service.cliServer = cliServer
	installWorkbenchMenu(app)
	app.Event.OnApplicationEvent(events.Common.ScreenLocked, func(_ *application.ApplicationEvent) { service.lockForSystem() })
	app.Event.OnApplicationEvent(events.Common.SystemWillSleep, func(_ *application.ApplicationEvent) { service.lockForSystem() })
	if err := service.initUpdater(app); err != nil {
		return err
	}
	app.HandleStream("terminal", service.handleTerminal)
	app.HandleStream("workspace", service.handleWorkspace)
	app.HandleStream("ai", service.handleAIStream)
	app.HandleStream("local-terminal", service.handleLocalTerminal)
	app.HandleStream("container-terminal", service.handleContainerTerminal)
	window := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:  "workbench",
		Title: "TermQuay", Width: 1280, Height: 820, MinWidth: 900, MinHeight: 600,
		BackgroundColour: application.NewRGB(16, 18, 22), URL: "/",
		EnableFileDrop: true,
		Frameless:      runtime.GOOS != "darwin",
		Mac:            application.MacWindow{TitleBar: application.MacTitleBarHidden, Backdrop: application.MacBackdropTranslucent},
		// 当前合成托管未转发 OLE 拖放，使用 HWND 托管接收资源管理器文件。
		Windows: application.WindowsWindow{NonClientRegionSupport: true, WebView2CompositionHosting: false},
	})
	window.OnWindowEvent(events.Common.WindowFilesDropped, func(event *application.WindowEvent) {
		if service.appLocked.Load() {
			return
		}
		details := event.Context().DropTargetDetails()
		if details == nil {
			return
		}
		id := details.Attributes["data-workspace-id"]
		directory := details.Attributes["data-remote-directory"]
		preview, err := service.prepareUploads(id, directory, event.Context().DroppedFiles())
		message := ""
		if err != nil {
			message = err.Error()
		}
		app.Event.Emit("files:upload-prepared", UploadPreparation{Preview: preview, Error: message, ErrorMessage: appmessage.Describe(err)})
	})
	window.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		if !service.canQuit() {
			event.Cancel()
		}
	})
	return app.Run()
}
