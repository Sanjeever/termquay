package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"sort"
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
	ID                  string             `json:"id"`
	DeviceID            string             `json:"device_id"`
	DeviceName          string             `json:"device_name"`
	CredentialsIncluded *bool              `json:"credentials_included"`
	CredentialUpdated   []string           `json:"credential_updated"`
	CreatedAt           time.Time          `json:"created_at"`
	Added               []string           `json:"added"`
	Updated             []string           `json:"updated"`
	Removed             []string           `json:"removed"`
	Credentials         int                `json:"credentials"`
	Connections         []store.Connection `json:"connections"`
	Settings            []string           `json:"settings"`
}

type pendingRestore struct {
	id             string
	data           store.Data
	base           store.Data
	expires        time.Time
	settingsBase   map[string]string
	sourceSettings map[string]string
	password       string
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
	if err == nil {
		a.store.SetChangeListener(a.queueAutomaticBackup)
	}
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
	a.store.SetChangeListener(a.queueAutomaticBackup)
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

func (a *AppService) MoveConnectionsToGroup(ids []string, groupID string) error {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if len(ids) == 0 || len(ids) > 256 {
		return errors.New("每批需选择 1 至 256 个连接")
	}
	if err := a.openStorage(); err != nil {
		return err
	}
	d, err := a.store.Read()
	if err != nil {
		return err
	}
	if groupID != "" {
		found := false
		for _, g := range d.Groups {
			if g.ID == groupID {
				found = true
				break
			}
		}
		if !found {
			return errors.New("目标分组不存在")
		}
	}
	indexes := make(map[string]int, len(d.Connections))
	for i, c := range d.Connections {
		indexes[c.ID] = i
	}
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		i, ok := indexes[id]
		if !ok || seen[id] {
			return errors.New("连接不存在或选择重复")
		}
		seen[id] = true
		d.Connections[i].GroupID = groupID
	}
	return a.store.Replace(d)
}

func (a *AppService) MoveGroup(id, parentID, beforeID string) error {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return err
	}
	d, err := a.store.Read()
	if err != nil {
		return err
	}
	index := -1
	parentFound := parentID == ""
	for i, g := range d.Groups {
		if g.ID == id {
			index = i
		}
		if g.ID == parentID {
			parentFound = true
		}
	}
	if index < 0 || !parentFound {
		return errors.New("分组或目标父分组不存在")
	}
	if id == beforeID {
		return errors.New("不能将分组移动到自身之前")
	}
	siblings := []int{}
	for i, g := range d.Groups {
		if i != index && g.ParentID == parentID {
			siblings = append(siblings, i)
		}
	}
	sort.SliceStable(siblings, func(i, j int) bool { return d.Groups[siblings[i]].SortOrder < d.Groups[siblings[j]].SortOrder })
	position := len(siblings)
	if beforeID != "" {
		position = -1
		for i, sibling := range siblings {
			if d.Groups[sibling].ID == beforeID {
				position = i
				break
			}
		}
		if position < 0 {
			return errors.New("排序目标已失效或不属于目标父分组")
		}
	}
	siblings = append(siblings, 0)
	copy(siblings[position+1:], siblings[position:])
	siblings[position] = index
	d.Groups[index].ParentID = parentID
	for order, i := range siblings {
		d.Groups[i].SortOrder = order
	}
	return a.store.Replace(d)
}

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

func (a *AppService) BackupWebDAV(ctx context.Context, options backup.WebDAVOptions, password string, includeCredentials bool) (string, error) {
	return a.BackupWebDAVWithSelection(ctx, options, password, BackupSelection{Credentials: includeCredentials})
}

func (a *AppService) BackupWebDAVWithSelection(ctx context.Context, options backup.WebDAVOptions, password string, selection BackupSelection) (string, error) {
	a.backupMu.Lock()
	defer a.backupMu.Unlock()
	encrypted, device, err := a.createSnapshot(password, selection)
	if err != nil {
		return "", err
	}
	return options.Append(ctx, device, encrypted)
}

func (a *AppService) createSnapshot(password string, selection BackupSelection) ([]byte, string, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return nil, "", err
	}
	d, err := a.store.Read()
	device, deviceErr := a.deviceID()
	if err != nil {
		return nil, "", err
	}
	if deviceErr != nil {
		return nil, "", deviceErr
	}
	if len(selection.ConnectionIDs) > 0 {
		d, err = selectSnapshotData(d, selection.ConnectionIDs)
		if err != nil {
			return nil, "", err
		}
	}
	if !selection.Credentials {
		d.Credentials = []store.Credential{}
		for i := range d.Connections {
			d.Connections[i].CredentialID = ""
		}
	}
	settings := map[string]string{}
	if selection.Snippets {
		values, err := a.snippets()
		if err != nil {
			return nil, "", err
		}
		encoded, err := json.Marshal(values)
		if err != nil {
			return nil, "", err
		}
		settings["snippets"] = string(encoded)
	}
	if selection.Settings {
		ui, err := a.portableUI()
		if err != nil {
			return nil, "", err
		}
		for key, value := range ui {
			settings[key] = value
		}
	}
	name, err := a.deviceName()
	if err != nil {
		return nil, "", err
	}
	encrypted, err := backup.EncryptSnapshot(backup.Snapshot{DeviceID: device, DeviceName: name, CreatedAt: time.Now().UTC(), Data: d, Settings: settings, CredentialsIncluded: &selection.Credentials}, password)
	return encrypted, device, err
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
	preview, err := a.prepareRestore(snap)
	if err == nil {
		a.preview.password = password
	}
	return preview, err
}

func (a *AppService) prepareRestore(snap backup.Snapshot) (RestorePreview, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return RestorePreview{}, err
	}
	current, err := a.store.Read()
	if err != nil {
		return RestorePreview{}, err
	}
	id := base64.RawURLEncoding.EncodeToString(randomBytes(24))
	p := RestorePreview{ID: id, DeviceID: snap.DeviceID, DeviceName: snap.DeviceName, CredentialsIncluded: snap.CredentialsIncluded, CreatedAt: snap.CreatedAt, Added: []string{}, Updated: []string{}, Removed: []string{}, Credentials: len(snap.Data.Credentials), CredentialUpdated: []string{}}
	p.Connections = snap.Data.Connections
	_, base, err := a.restoreSettings(snap.Settings)
	if err != nil {
		return RestorePreview{}, err
	}
	for key := range snap.Settings {
		p.Settings = append(p.Settings, key)
	}
	sort.Strings(p.Settings)
	old := map[string]store.Connection{}
	oldCredentials := map[string]store.Credential{}
	newCredentials := map[string]store.Credential{}
	for _, credential := range current.Credentials {
		oldCredentials[credential.ID] = credential
	}
	for _, credential := range snap.Data.Credentials {
		newCredentials[credential.ID] = credential
	}
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
		if ok && !reflect.DeepEqual(oldCredentials[before.CredentialID], newCredentials[c.CredentialID]) {
			p.CredentialUpdated = append(p.CredentialUpdated, c.Name)
		}
		delete(old, c.ID)
	}
	for _, c := range old {
		p.Removed = append(p.Removed, c.Name)
	}
	sort.Strings(p.Removed)
	a.preview = &pendingRestore{id: id, data: snap.Data, base: current, expires: time.Now().Add(5 * time.Minute), settingsBase: base, sourceSettings: snap.Settings}
	return p, nil
}

func (a *AppService) ConfirmRestore(id string) error {
	return a.ConfirmRestoreSelection(id, nil, true, true)
}

func (a *AppService) ConfirmRestoreSelection(id string, connectionIDs []string, replace, restoreSettings bool) error {
	keys := []string{}
	if restoreSettings {
		keys = []string{"snippets", "appearance", "shortcuts"}
	}
	return a.ConfirmRestoreWithOptions(id, connectionIDs, replace, keys)
}

func (a *AppService) ConfirmRestoreWithOptions(id string, connectionIDs []string, replace bool, settingKeys []string) error {
	a.backupMu.Lock()
	defer a.backupMu.Unlock()
	if a.preview == nil || a.preview.id != id {
		return errors.New("恢复预览已失效，请重新预览")
	}
	if time.Now().After(a.preview.expires) {
		a.preview = nil
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
	data := a.preview.data
	settings := map[string]string{}
	selectedSettings := map[string]string{}
	for _, key := range settingKeys {
		if key != "snippets" && key != "appearance" && key != "shortcuts" {
			return errors.New("恢复设置包含未知选项")
		}
		if value, ok := a.preview.sourceSettings[key]; ok {
			selectedSettings[key] = value
		}
	}
	if len(selectedSettings) > 0 {
		for sourceKey := range selectedSettings {
			key := "portable_ui"
			if sourceKey == "snippets" {
				key = "snippets"
			}
			expected := a.preview.settingsBase[key]
			value, err := a.store.Setting(key)
			if err != nil {
				return err
			}
			if value != expected {
				return errors.New("本机设置在预览后发生变化，请重新预览")
			}
		}
		settings, _, err = a.restoreSettings(selectedSettings)
		if err != nil {
			return err
		}
	}
	if !replace {
		selected, err := selectSnapshotData(data, connectionIDs)
		if err != nil {
			return err
		}
		data = mergeSnapshotCopies(current, selected)
	}
	if replace {
		if err := a.protectRestore(current); err != nil {
			return err
		}
	}
	if err := a.store.ReplaceWithSettings(data, settings); err != nil {
		return err
	}
	a.preview = nil
	return nil
}

func (a *AppService) CancelRestorePreview(id string) {
	a.backupMu.Lock()
	defer a.backupMu.Unlock()
	if a.preview != nil && a.preview.id == id {
		a.preview = nil
	}
}
