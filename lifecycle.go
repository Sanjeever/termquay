package main

import "github.com/wailsapp/wails/v3/pkg/application"

func (a *AppService) SetWorkspaceDirty(id string, dirty bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.workspaces[id] == nil {
		return
	}
	if dirty {
		a.dirty[id] = true
	} else {
		delete(a.dirty, id)
	}
}
func (a *AppService) canQuit() bool {
	a.mu.Lock()
	blocked := !a.allowQuit && len(a.dirty) > 0
	a.mu.Unlock()
	if blocked {
		application.Get().Event.Emit("app:close-requested")
	}
	return !blocked
}
func (a *AppService) DiscardAndQuit() {
	a.mu.Lock()
	a.allowQuit = true
	a.mu.Unlock()
	application.Get().Quit()
}
