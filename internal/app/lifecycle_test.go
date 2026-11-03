package app

import "testing"

func TestDisconnectedDraftRemainsProtectedUntilViewCloses(t *testing.T) {
	a := NewAppService(BuildInfo{Development: true}, nil)
	if err := a.RegisterWorkspaceView("view"); err != nil {
		t.Fatal(err)
	}
	if err := a.SetWorkspaceDirty("view", true); err != nil {
		t.Fatal(err)
	}
	a.CloseWorkspace("view")
	if !a.dirty["view"] {
		t.Fatal("网络断开移除草稿退出保护")
	}
	a.ReleaseWorkspaceView("view")
	if a.dirty["view"] {
		t.Fatal("关闭界面未释放退出保护")
	}
	if err := a.SetWorkspaceDirty("view", true); err == nil {
		t.Fatal("旧异步更新重新建立退出保护")
	}
}
