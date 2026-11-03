package app

import (
	"errors"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func (a *AppService) SetWorkspaceDirty(id string, dirty bool) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.views[id] {
		return errors.New("界面工作区已关闭")
	}
	if dirty {
		a.dirty[id] = true
	} else {
		delete(a.dirty, id)
	}
	return nil
}
func (a *AppService) RegisterWorkspaceView(id string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if id == "" || len(id) > 64 || a.closed || (!a.views[id] && len(a.views) >= 16) {
		return errors.New("界面工作区标识无效或达到上限（16 个）")
	}
	a.views[id] = true
	return nil
}
func (a *AppService) ReleaseWorkspaceView(id string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.views, id)
	delete(a.dirty, id)
}
func (a *AppService) canQuit() bool {
	a.mu.Lock()
	blocked := !a.allowQuit && (a.frontendReady || len(a.dirty) > 0)
	a.mu.Unlock()
	if blocked {
		application.Get().Event.Emit("app:close-requested")
	}
	return !blocked
}
func (a *AppService) SetFrontendReady() { a.mu.Lock(); a.frontendReady = true; a.mu.Unlock() }
func (a *AppService) DiscardAndQuit() {
	a.mu.Lock()
	a.allowQuit = true
	a.mu.Unlock()
	application.Get().Quit()
}
