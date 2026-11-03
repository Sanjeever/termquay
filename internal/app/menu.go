package app

import (
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func init() {
	application.RegisterEvent[map[string]string]("app:menu-state")
	application.RegisterEvent[string]("app:menu-command")
}

func installWorkbenchMenu(app *application.App) {
	if runtime.GOOS != "darwin" {
		return
	}
	menu := application.NewMenu()
	items := map[string]*application.MenuItem{}
	labels := map[string]string{}
	add := func(parent *application.Menu, id, label string) {
		items[id] = parent.Add(label).SetEnabled(false).OnClick(func(_ *application.Context) {
			app.Event.Emit("app:menu-command", id)
		})
		labels[id] = label
	}
	appMenu := menu.AddSubmenu("TermQuay")
	add(appMenu, "about", "关于 TermQuay")
	add(appMenu, "settings", "设置…")
	appMenu.AddSeparator()
	appMenu.AddRole(application.ServicesMenu)
	appMenu.AddSeparator()
	appMenu.AddRole(application.Hide)
	appMenu.AddRole(application.HideOthers)
	appMenu.AddRole(application.UnHide)
	appMenu.AddSeparator()
	appMenu.AddRole(application.Quit)
	file := menu.AddSubmenu("文件")
	add(file, "new", "新建连接…")
	add(file, "quick", "快速连接…")
	add(file, "newTerminal", "新建终端")
	file.AddSeparator()
	add(file, "closeTab", "关闭当前标签")
	add(file, "closeWorkspace", "关闭工作区")
	edit := menu.AddSubmenu("编辑")
	for _, role := range []application.Role{application.Undo, application.Redo, application.Cut, application.Copy, application.Paste, application.SelectAll} {
		edit.AddRole(role)
	}
	view := menu.AddSubmenu("显示")
	add(view, "palette", "命令搜索…")
	add(view, "connections", "连接中心")
	add(view, "transfers", "传输任务")
	view.AddSeparator()
	add(view, "files", "远端文件")
	add(view, "monitor", "监控")
	add(view, "focus", "专注模式")
	view.AddSeparator()
	add(view, "uiZoomIn", "放大界面")
	add(view, "uiZoomOut", "缩小界面")
	add(view, "uiZoomReset", "实际大小")
	window := menu.AddSubmenu("窗口")
	add(window, "nextWorkspace", "下一个工作区")
	add(window, "previousWorkspace", "上一个工作区")
	window.AddSeparator()
	window.AddRole(application.Minimise)
	window.AddRole(application.Zoom)
	window.AddRole(application.FullScreen)
	window.AddRole(application.BringAllToFront)
	app.Menu.Set(menu)
	app.Event.On("app:menu-state", func(event *application.CustomEvent) {
		state := event.Data.(map[string]string)
		application.InvokeAsync(func() {
			for id, item := range items {
				hint, enabled := state[id]
				label := labels[id]
				// 按键由 WebView 统一分发，菜单显示当前键位，保留 RDP 远端归属和输入法组合输入。
				if hint != "" {
					label += "    " + hint
				}
				item.SetLabel(label).SetEnabled(enabled)
			}
		})
	})
}
