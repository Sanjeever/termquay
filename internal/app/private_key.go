package app

import (
	"encoding/base64"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"github.com/wailsapp/wails/v3/pkg/application"
	"io"
	"os"
	"path/filepath"
	"time"
)

type PrivateKeySelection struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type stagedPrivateKey struct {
	data    []byte
	expires time.Time
	timer   *time.Timer
}

func (a *AppService) SelectPrivateKey() (PrivateKeySelection, error) {
	name, err := application.Get().Dialog.OpenFile().SetTitle(nativeText("Select SSH private key", "选择 SSH 私钥")).PromptForSingleSelection()
	if err != nil || name == "" {
		return PrivateKeySelection{}, err
	}
	return a.stagePrivateKey(name)
}
func (a *AppService) stagePrivateKey(name string) (PrivateKeySelection, error) {
	f, err := os.Open(name)
	if err != nil {
		return PrivateKeySelection{}, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return PrivateKeySelection{}, err
	}
	if !info.Mode().IsRegular() || info.Size() > 1<<20 {
		return PrivateKeySelection{}, appmessage.New("backend:privateKeyMustBeARegularFileWithin", "私钥必须是 1 MiB 内的普通文件")
	}
	data, err := io.ReadAll(io.LimitReader(f, (1<<20)+1))
	if err != nil {
		return PrivateKeySelection{}, err
	}
	if len(data) > 1<<20 {
		return PrivateKeySelection{}, appmessage.New("backend:privateKeyExceeds1MiBLimit", "私钥超过 1 MiB 上限")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	for id, key := range a.privateKeys {
		if time.Now().After(key.expires) {
			clear(key.data)
			delete(a.privateKeys, id)
		}
	}
	if len(a.privateKeys) >= 4 {
		return PrivateKeySelection{}, appmessage.New("backend:pendingPrivateKeyLimitReached4", "待使用私钥达到上限（4 个）")
	}
	id := base64.RawURLEncoding.EncodeToString(randomBytes(24))
	a.privateKeys[id] = stagedPrivateKey{data: data, expires: time.Now().Add(5 * time.Minute), timer: time.AfterFunc(5*time.Minute, func() { a.ReleasePrivateKey(id) })}
	return PrivateKeySelection{ID: id, Name: filepath.Base(name)}, nil
}
func (a *AppService) ReleasePrivateKey(id string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	key := a.privateKeys[id]
	if key.timer != nil {
		key.timer.Stop()
	}
	clear(key.data)
	delete(a.privateKeys, id)
}
func (a *AppService) resolvePrivateKey(r *terminal.Request) error {
	if r.PrivateKeyToken == "" {
		return nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	key, ok := a.privateKeys[r.PrivateKeyToken]
	if !ok || time.Now().After(key.expires) {
		return appmessage.New("backend:privateKeySelectionExpiredSelectAgain", "私钥选择已失效，请重新选择")
	}
	if r.PrivateKey != "" || r.AuthMethod == "agent" {
		return appmessage.New("backend:privateKeyFileConflictsWithAuthenticationMethod", "私钥文件与认证方式冲突")
	}
	r.PrivateKey = string(key.data)
	return nil
}
