package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"time"

	"github.com/Sanjeever/termquay/internal/backup"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"github.com/Sanjeever/termquay/internal/store"
)

type Catalog struct {
	Groups      []store.Group      `json:"groups"`
	Connections []store.Connection `json:"connections"`
	SessionOnly bool               `json:"session_only"`
}

type RestorePreview struct {
	ID          string    `json:"id"`
	DeviceID    string    `json:"device_id"`
	CreatedAt   time.Time `json:"created_at"`
	Added       []string  `json:"added"`
	Updated     []string  `json:"updated"`
	Removed     []string  `json:"removed"`
	Credentials int       `json:"credentials"`
}

type pendingRestore struct {
	id      string
	data    store.Data
	base    store.Data
	expires time.Time
}

func (a *AppService) openStorage() error {
	if a.store != nil {
		return nil
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return err
	}
	a.store, err = store.OpenVault(filepath.Join(dir, "TermQuay"))
	return err
}

func (a *AppService) UseSessionStorage() error {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if a.store != nil {
		return errors.New("存储已经打开")
	}
	dir, err := os.MkdirTemp("", "termquay-session-")
	if err != nil {
		return err
	}
	a.store, err = store.Open(dir, randomBytes(32))
	if err != nil {
		os.RemoveAll(dir)
		return err
	}
	a.sessionDir = dir
	return nil
}

func (a *AppService) GetCatalog() (Catalog, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return Catalog{}, err
	}
	d, err := a.store.Read()
	return Catalog{Groups: d.Groups, Connections: d.Connections, SessionOnly: a.sessionDir != ""}, err
}

func (a *AppService) SaveGroup(g store.Group) error {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return err
	}
	d, err := a.store.Read()
	if err != nil {
		return err
	}
	if g.ID == "" {
		g.ID = base64.RawURLEncoding.EncodeToString(randomBytes(16))
	}
	found := false
	for i, old := range d.Groups {
		if old.ID == g.ID {
			d.Groups[i] = g
			found = true
			break
		}
	}
	if !found {
		d.Groups = append(d.Groups, g)
	}
	return a.store.Replace(d)
}

func (a *AppService) DeleteGroup(id string) error {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return err
	}
	d, err := a.store.Read()
	if err != nil {
		return err
	}
	groups := d.Groups[:0]
	for _, g := range d.Groups {
		if g.ParentID == id {
			return errors.New("分组仍有子分组")
		}
		if g.ID != id {
			groups = append(groups, g)
		}
	}
	d.Groups = groups
	for _, c := range d.Connections {
		if c.GroupID == id {
			return errors.New("分组仍有连接")
		}
	}
	return a.store.Replace(d)
}

func (a *AppService) SaveConnection(c store.Connection, auth terminal.Request) (store.Connection, error) {
	if err := a.resolvePrivateKey(&auth); err != nil {
		return store.Connection{}, err
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return store.Connection{}, err
	}
	d, err := a.store.Read()
	if err != nil {
		return store.Connection{}, err
	}
	if c.ID == "" {
		c.ID = base64.RawURLEncoding.EncodeToString(randomBytes(16))
	}
	c.CredentialID = ""
	oldMethod := ""
	for _, old := range d.Connections {
		if old.ID == c.ID {
			c.CredentialID = old.CredentialID
			oldMethod = old.AuthMethod
			break
		}
	}
	if c.AuthMethod == "agent" {
		c.CredentialID = ""
		auth.Password = ""
		auth.PrivateKey = ""
	}
	if c.CredentialID != "" && auth.Password == "" && auth.PrivateKey == "" {
		c.AuthMethod = oldMethod
	}
	if auth.Password != "" || auth.PrivateKey != "" {
		if c.CredentialID == "" {
			c.CredentialID = base64.RawURLEncoding.EncodeToString(randomBytes(16))
		}
		credential := store.Credential{ID: c.CredentialID, Kind: "password", Secret: auth.Password}
		if auth.PrivateKey != "" {
			c.AuthMethod = "private_key"
			credential.Kind = "private_key"
			b, err := json.Marshal(struct {
				Key        string `json:"key"`
				Passphrase string `json:"passphrase"`
			}{auth.PrivateKey, auth.Passphrase})
			if err != nil {
				return store.Connection{}, err
			}
			credential.Secret = string(b)
		} else if c.Protocol == "ssh" {
			c.AuthMethod = "password"
		}
		found := false
		for i, old := range d.Credentials {
			if old.ID == credential.ID {
				d.Credentials[i] = credential
				found = true
				break
			}
		}
		if !found {
			d.Credentials = append(d.Credentials, credential)
		}
	}
	found := false
	for i, old := range d.Connections {
		if old.ID == c.ID {
			d.Connections[i] = c
			found = true
			break
		}
	}
	if !found {
		d.Connections = append(d.Connections, c)
	}
	used := map[string]bool{}
	for _, connection := range d.Connections {
		used[connection.CredentialID] = true
	}
	credentials := d.Credentials[:0]
	for _, credential := range d.Credentials {
		if used[credential.ID] {
			credentials = append(credentials, credential)
		}
	}
	d.Credentials = credentials
	if err := a.store.Replace(d); err != nil {
		return store.Connection{}, err
	}
	return c, nil
}

func (a *AppService) DuplicateConnection(id string, includeCredentials bool) (store.Connection, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return store.Connection{}, err
	}
	d, err := a.store.Read()
	if err != nil {
		return store.Connection{}, err
	}
	for _, source := range d.Connections {
		if source.ID != id {
			continue
		}
		copy := source
		copy.ID = base64.RawURLEncoding.EncodeToString(randomBytes(16))
		copy.Name += " 副本"
		copy.CredentialID = ""
		if includeCredentials && source.CredentialID != "" {
			found := false
			for _, credential := range d.Credentials {
				if credential.ID != source.CredentialID {
					continue
				}
				credential.ID = base64.RawURLEncoding.EncodeToString(randomBytes(16))
				copy.CredentialID = credential.ID
				d.Credentials = append(d.Credentials, credential)
				found = true
				break
			}
			if !found {
				return store.Connection{}, errors.New("连接凭据不存在")
			}
		}
		d.Connections = append(d.Connections, copy)
		if err = a.store.Replace(d); err != nil {
			return store.Connection{}, err
		}
		return copy, nil
	}
	return store.Connection{}, errors.New("连接不存在")
}

func (a *AppService) DeleteConnection(id string) error {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return err
	}
	d, err := a.store.Read()
	if err != nil {
		return err
	}
	for _, c := range d.Connections {
		if c.JumpID == id {
			return errors.New("此连接仍被用作跳板机")
		}
	}
	connections := d.Connections[:0]
	credentialID := ""
	for _, c := range d.Connections {
		if c.ID == id {
			credentialID = c.CredentialID
		} else {
			connections = append(connections, c)
		}
	}
	d.Connections = connections
	used := false
	for _, c := range connections {
		if c.CredentialID == credentialID {
			used = true
		}
	}
	if !used {
		credentials := d.Credentials[:0]
		for _, c := range d.Credentials {
			if c.ID != credentialID {
				credentials = append(credentials, c)
			}
		}
		d.Credentials = credentials
	}
	return a.store.Replace(d)
}

func (a *AppService) savedRequest(id string) (terminal.Request, store.Connection, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return terminal.Request{}, store.Connection{}, err
	}
	d, err := a.store.Read()
	if err != nil {
		return terminal.Request{}, store.Connection{}, err
	}
	for _, c := range d.Connections {
		if c.ID != id {
			continue
		}
		r := terminal.Request{Host: c.Host, Port: c.Port, Username: c.Username, Cols: 100, Rows: 30, AuthMethod: c.AuthMethod, IdentityAgent: c.IdentityAgent, JumpID: c.JumpID}
		for _, credential := range d.Credentials {
			if credential.ID != c.CredentialID {
				continue
			}
			if credential.Kind == "password" {
				r.Password = credential.Secret
			} else {
				var key struct {
					Key        string `json:"key"`
					Passphrase string `json:"passphrase"`
				}
				if err = json.Unmarshal([]byte(credential.Secret), &key); err != nil {
					return r, c, err
				}
				r.PrivateKey = key.Key
				r.Passphrase = key.Passphrase
			}
		}
		if c.AuthMethod == "private_key" && r.PrivateKey == "" {
			preferences, e := a.store.ConnectionPreferences()
			if e != nil {
				return r, c, e
			}
			if name := preferences[c.ID].PrivateKeyPath; name != "" {
				f, e := os.Open(name)
				if e != nil {
					return r, c, e
				}
				info, e := f.Stat()
				if e != nil || !info.Mode().IsRegular() || info.Size() > 1<<20 {
					f.Close()
					return r, c, errors.New("导入私钥引用无效或超过 1 MiB")
				}
				key, e := io.ReadAll(io.LimitReader(f, (1<<20)+1))
				f.Close()
				if e != nil {
					return r, c, e
				}
				if len(key) > 1<<20 {
					return r, c, errors.New("私钥超过 1 MiB")
				}
				r.PrivateKey = string(key)
			}
		}
		return r, c, nil
	}
	return terminal.Request{}, store.Connection{}, errors.New("连接不存在")
}

func (a *AppService) OpenSavedTerminal(ctx context.Context, id string) (OpenResult, error) {
	r, c, err := a.savedRequest(id)
	if err != nil {
		return OpenResult{}, err
	}
	if c.Protocol != "ssh" {
		return OpenResult{}, errors.New("所选连接不是 SSH")
	}
	return a.OpenTerminal(ctx, r)
}

func (a *AppService) BackupWebDAV(ctx context.Context, options backup.WebDAVOptions, password string, includeCredentials bool) (string, error) {
	a.backupMu.Lock()
	defer a.backupMu.Unlock()
	a.storeMu.Lock()
	if err := a.openStorage(); err != nil {
		a.storeMu.Unlock()
		return "", err
	}
	d, err := a.store.Read()
	device, deviceErr := a.deviceID()
	a.storeMu.Unlock()
	if err != nil {
		return "", err
	}
	if deviceErr != nil {
		return "", deviceErr
	}
	if !includeCredentials {
		d.Credentials = []store.Credential{}
		for i := range d.Connections {
			d.Connections[i].CredentialID = ""
		}
	}
	encrypted, err := backup.Encrypt(d, device, password)
	if err != nil {
		return "", err
	}
	return options.Append(ctx, device, encrypted)
}

func (a *AppService) deviceID() (string, error) {
	id, err := a.store.Setting("device_id")
	if err != nil {
		return "", err
	}
	if id == "" {
		id = base64.RawURLEncoding.EncodeToString(randomBytes(16))
		err = a.store.SetSetting("device_id", id)
	}
	return id, err
}

func (a *AppService) TestWebDAV(ctx context.Context, options backup.WebDAVOptions) error {
	return options.Test(ctx)
}
func (a *AppService) ListSnapshots(ctx context.Context, options backup.WebDAVOptions) ([]backup.RemoteSnapshot, error) {
	return options.List(ctx)
}

func (a *AppService) PreviewRestore(ctx context.Context, options backup.WebDAVOptions, path, password string) (RestorePreview, error) {
	a.backupMu.Lock()
	defer a.backupMu.Unlock()
	a.preview = nil
	encrypted, err := options.Read(ctx, path)
	if err != nil {
		return RestorePreview{}, err
	}
	snap, err := backup.Decrypt(encrypted, password)
	if err != nil {
		return RestorePreview{}, err
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err = a.openStorage(); err != nil {
		return RestorePreview{}, err
	}
	current, err := a.store.Read()
	if err != nil {
		return RestorePreview{}, err
	}
	id := base64.RawURLEncoding.EncodeToString(randomBytes(24))
	p := RestorePreview{ID: id, DeviceID: snap.DeviceID, CreatedAt: snap.CreatedAt, Added: []string{}, Updated: []string{}, Removed: []string{}, Credentials: len(snap.Data.Credentials)}
	old := map[string]store.Connection{}
	for _, c := range current.Connections {
		old[c.ID] = c
	}
	for _, c := range snap.Data.Connections {
		before, ok := old[c.ID]
		if !ok {
			p.Added = append(p.Added, c.Name)
		} else if !reflect.DeepEqual(before, c) {
			p.Updated = append(p.Updated, c.Name)
		}
		delete(old, c.ID)
	}
	for _, c := range old {
		p.Removed = append(p.Removed, c.Name)
	}
	a.preview = &pendingRestore{id: id, data: snap.Data, base: current, expires: time.Now().Add(5 * time.Minute)}
	return p, nil
}

func (a *AppService) ConfirmRestore(id string) error {
	a.backupMu.Lock()
	defer a.backupMu.Unlock()
	if a.preview == nil || a.preview.id != id || time.Now().After(a.preview.expires) {
		return errors.New("恢复预览已失效，请重新预览")
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return err
	}
	current, err := a.store.Read()
	if err != nil {
		return err
	}
	if !reflect.DeepEqual(current, a.preview.base) {
		return errors.New("本地连接在预览后发生变化，请重新预览")
	}
	if err := a.store.Replace(a.preview.data); err != nil {
		return err
	}
	a.preview = nil
	return nil
}
