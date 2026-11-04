package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"os"

	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"github.com/Sanjeever/termquay/internal/store"
)

func (a *AppService) SaveConnection(c store.Connection, auth terminal.Request) (store.Connection, error) {
	return a.SaveConnectionWithCredential(c, auth, "")
}

func (a *AppService) SaveConnectionWithCredential(c store.Connection, auth terminal.Request, referenceID string) (store.Connection, error) {
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
	if referenceID != "" {
		if auth.Password != "" || auth.PrivateKey != "" {
			return store.Connection{}, errors.New("复用凭据时不能同时填写新秘密")
		}
		found := false
		for _, credential := range d.Credentials {
			if credential.ID == referenceID {
				if c.Protocol == "rdp" && credential.Kind != "password" {
					return store.Connection{}, errors.New("RDP 需要密码凭据")
				}
				c.CredentialID = referenceID
				if c.Protocol == "ssh" {
					c.AuthMethod = credential.Kind
				}
				oldMethod = c.AuthMethod
				found = true
				break
			}
		}
		if !found {
			return store.Connection{}, errors.New("引用凭据已失效")
		}
	}
	if c.AuthMethod == "agent" || c.AuthMethod == "keyboard_interactive" {
		c.CredentialID = ""
		auth.Password = ""
		auth.PrivateKey = ""
	}
	if c.CredentialID != "" && auth.Password == "" && auth.PrivateKey == "" {
		c.AuthMethod = oldMethod
	}
	if auth.Password != "" || auth.PrivateKey != "" {
		references := 0
		for _, old := range d.Connections {
			if old.CredentialID == c.CredentialID {
				references++
			}
		}
		if references > 1 {
			c.CredentialID = ""
		}
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

func (a *AppService) GetConnectionPassword(id string) (string, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return "", err
	}
	d, err := a.store.Read()
	if err != nil {
		return "", err
	}
	for _, c := range d.Connections {
		if c.ID != id {
			continue
		}
		if c.CredentialID == "" {
			return "", nil
		}
		for _, credential := range d.Credentials {
			if credential.ID == c.CredentialID {
				if credential.Kind != "password" {
					return "", errors.New("所选连接未使用密码凭据")
				}
				return credential.Secret, nil
			}
		}
		return "", errors.New("连接凭据不存在")
	}
	return "", errors.New("连接不存在")
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
	return a.requestFromData(d, id)
}

func (a *AppService) requestFromData(d store.Data, id string) (terminal.Request, store.Connection, error) {
	for _, c := range d.Connections {
		if c.ID != id {
			continue
		}
		r := terminal.Request{Host: c.Host, Port: c.Port, Username: c.Username, Cols: 100, Rows: 30, AuthMethod: c.AuthMethod, IdentityAgent: c.IdentityAgent, JumpID: c.JumpID, MFA: c.MFA, Certificate: c.Certificate, ProxyAddress: c.ProxyAddress}
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
				if err := json.Unmarshal([]byte(credential.Secret), &key); err != nil {
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
