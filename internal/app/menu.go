package app

import (
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func init() {
	application.RegisterEvent[map[string]string]("app:menu-state")
	application.RegisterEvent[string]("app:menu-command")
	application.RegisterEvent[string]("app:language")
}

func buildWorkbenchMenu(app *application.App) func(map[string]string) {
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
	add(appMenu, "about", nativeText("About TermQuay", "关于 TermQuay"))
	add(appMenu, "settings", nativeText("Settings…", "设置…"))
	appMenu.AddSeparator()
	appMenu.AddRole(application.ServicesMenu).SetLabel(nativeText("Services", "服务"))
	appMenu.AddSeparator()
	appMenu.AddRole(application.Hide).SetLabel(nativeText("Hide TermQuay", "隐藏 TermQuay"))
	appMenu.AddRole(application.HideOthers).SetLabel(nativeText("Hide Others", "隐藏其他"))
	appMenu.AddRole(application.UnHide).SetLabel(nativeText("Show All", "全部显示"))
	appMenu.AddSeparator()
	appMenu.AddRole(application.Quit).SetLabel(nativeText("Quit TermQuay", "退出 TermQuay"))
	file := menu.AddSubmenu(nativeText("File", "文件"))
	add(file, "new", nativeText("New Connection…", "新建连接…"))
	add(file, "quick", nativeText("Quick Connect…", "快速连接…"))
	add(file, "newTerminal", nativeText("New Terminal", "新建终端"))
	file.AddSeparator()
	add(file, "closeTab", nativeText("Close Current Tab", "关闭当前标签"))
	add(file, "closeWorkspace", nativeText("Close Workspace", "关闭工作区"))
	edit := menu.AddSubmenu(nativeText("Edit", "编辑"))
	for _, role := range []application.Role{application.Undo, application.Redo, application.Cut, application.Copy, application.Paste, application.SelectAll} {
		labels := map[application.Role][2]string{application.Undo: {"Undo", "撤销"}, application.Redo: {"Redo", "重做"}, application.Cut: {"Cut", "剪切"}, application.Copy: {"Copy", "复制"}, application.Paste: {"Paste", "粘贴"}, application.SelectAll: {"Select All", "全选"}}
		label := labels[role]
		edit.AddRole(role).SetLabel(nativeText(label[0], label[1]))
	}
	view := menu.AddSubmenu(nativeText("View", "显示"))
	add(view, "palette", nativeText("Command Search…", "命令搜索…"))
	add(view, "connections", nativeText("Connection Center", "连接中心"))
	add(view, "transfers", nativeText("Transfers", "传输任务"))
	view.AddSeparator()
	add(view, "files", nativeText("Remote Files", "远端文件"))
	add(view, "monitor", nativeText("Monitoring", "监控"))
	add(view, "focus", nativeText("Focus Mode", "专注模式"))
	view.AddSeparator()
	add(view, "uiZoomIn", nativeText("Zoom In", "放大界面"))
	add(view, "uiZoomOut", nativeText("Zoom Out", "缩小界面"))
	add(view, "uiZoomReset", nativeText("Actual Size", "实际大小"))
	window := menu.AddSubmenu(nativeText("Window", "窗口"))
	add(window, "nextWorkspace", nativeText("Next Workspace", "下一个工作区"))
	add(window, "previousWorkspace", nativeText("Previous Workspace", "上一个工作区"))
	window.AddSeparator()
	window.AddRole(application.Minimise).SetLabel(nativeText("Minimize", "最小化"))
	window.AddRole(application.Zoom).SetLabel(nativeText("Zoom", "缩放"))
	window.AddRole(application.FullScreen).SetLabel(nativeText("Enter Full Screen", "进入全屏"))
	window.AddRole(application.BringAllToFront).SetLabel(nativeText("Bring All to Front", "全部置于前台"))
	app.Menu.Set(menu)
	return func(state map[string]string) {
		for id, item := range items {
			hint, enabled := state[id]
			label := labels[id]
			if hint != "" {
				label += "    " + hint
			}
			item.SetLabel(label).SetEnabled(enabled)
		}
	}

}

func installWorkbenchMenu(app *application.App) {
	if runtime.GOOS != "darwin" {
		return
	}
	// Menu objects and state are only touched on the native UI thread.
	state := map[string]string{}
	update := buildWorkbenchMenu(app)
	update(state)
	app.Event.On("app:menu-state", func(event *application.CustomEvent) {
		value := event.Data.(map[string]string)
		application.InvokeAsync(func() {
			state = value
			update(state)
		})
	})
	app.Event.On("app:language", func(_ *application.CustomEvent) {
		application.InvokeAsync(func() { update = buildWorkbenchMenu(app); update(state) })
	})
}
