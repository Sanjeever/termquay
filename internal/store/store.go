package store

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

type Group struct {
	ID        string `json:"id"`
	ParentID  string `json:"parent_id"`
	Name      string `json:"name"`
	SortOrder int    `json:"sort_order"`
}

type Connection struct {
	ID            string `json:"id"`
	GroupID       string `json:"group_id"`
	Name          string `json:"name"`
	Protocol      string `json:"protocol"`
	Host          string `json:"host"`
	Port          int    `json:"port"`
	Username      string `json:"username"`
	Domain        string `json:"domain,omitempty"`
	CredentialID  string `json:"credential_id"`
	AuthMethod    string `json:"auth_method,omitempty"`
	IdentityAgent string `json:"identity_agent,omitempty"`
	JumpID        string `json:"jump_id,omitempty"`
	MFA           bool   `json:"mfa,omitempty"`
	Certificate   string `json:"certificate,omitempty"`
	ProxyAddress  string `json:"proxy_address,omitempty"`
}

type Credential struct {
	ID     string `json:"id"`
	Kind   string `json:"kind"`
	Secret string `json:"secret"`
}

type Data struct {
	Groups      []Group      `json:"groups"`
	Connections []Connection `json:"connections"`
	Credentials []Credential `json:"credentials"`
}

func (d Data) Validate() error {
	groups := map[string]string{}
	for _, g := range d.Groups {
		if g.ID == "" || g.Name == "" {
			return errors.New("分组 ID 和名称不能为空")
		}
		if _, ok := groups[g.ID]; ok {
			return errors.New("分组 ID 重复")
		}
		groups[g.ID] = g.ParentID
	}
	for id := range groups {
		seen := map[string]bool{}
		for id != "" {
			if seen[id] {
				return errors.New("分组存在循环引用")
			}
			seen[id] = true
			parent, ok := groups[id]
			if !ok {
				return errors.New("父分组不存在")
			}
			id = parent
		}
	}
	credentials := map[string]bool{}
	kinds := map[string]string{}
	for _, c := range d.Credentials {
		if c.ID == "" || credentials[c.ID] || (c.Kind != "password" && c.Kind != "private_key") {
			return errors.New("凭据 ID 或类型无效")
		}
		credentials[c.ID] = true
		kinds[c.ID] = c.Kind
	}
	connections := map[string]bool{}
	configs := map[string]Connection{}
	for _, c := range d.Connections {
		if len(c.Certificate) > 64<<10 || (c.Certificate != "" && (c.Protocol != "ssh" || c.AuthMethod != "private_key")) || len(c.ProxyAddress) > 1024 || (c.ProxyAddress != "" && (c.Protocol != "ssh" || c.JumpID != "")) {
			return errors.New("用户证书或 SOCKS5 代理配置无效；代理与跳板不能同时设置")
		}
		if (c.AuthMethod != "" && c.AuthMethod != "password" && c.AuthMethod != "private_key" && c.AuthMethod != "agent" && c.AuthMethod != "keyboard_interactive") || (c.Protocol != "ssh" && (c.AuthMethod != "" || c.IdentityAgent != "" || c.MFA)) || len(c.IdentityAgent) > 4096 || ((c.AuthMethod == "agent" || c.AuthMethod == "keyboard_interactive") && c.CredentialID != "") {
			return errors.New("连接认证配置无效")
		}
		if c.ID == "" || connections[c.ID] || c.Name == "" || c.Host == "" || c.Port < 1 || c.Port > 65535 || (c.Protocol != "ssh" && c.Protocol != "rdp") {
			return errors.New("连接配置无效")
		}
		connections[c.ID] = true
		configs[c.ID] = c
		if c.GroupID != "" {
			if _, ok := groups[c.GroupID]; !ok {
				return errors.New("连接引用的分组不存在")
			}
		}
		if c.CredentialID != "" && !credentials[c.CredentialID] {
			return errors.New("连接引用的凭据不存在")
		}
		if c.CredentialID != "" && ((c.AuthMethod == "private_key" && kinds[c.CredentialID] != "private_key") || (c.AuthMethod == "password" && kinds[c.CredentialID] != "password")) {
			return errors.New("连接认证方式与凭据类型不一致")
		}
	}
	for _, c := range d.Connections {
		if c.JumpID != "" {
			jump, ok := configs[c.JumpID]
			if !ok || c.Protocol != "ssh" || jump.Protocol != "ssh" || jump.JumpID != "" || c.ID == c.JumpID {
				return errors.New("跳板引用无效；仅支持不同 SSH 配置的单跳连接")
			}
		}
	}
	return nil
}

type Store struct {
	db      *sql.DB
	aead    cipher.AEAD
	changed func()
}

func (s *Store) SetChangeListener(changed func()) { s.changed = changed }

func Open(dir string, key []byte) (*Store, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	path := filepath.Join(dir, "termquay.db")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = f.Close(); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db, aead: aead}
	var version int
	if err = db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		db.Close()
		return nil, err
	}
	if version > 1 {
		db.Close()
		return nil, errors.New("数据库版本高于当前应用支持范围")
	}
	_, err = db.Exec(`PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS credentials (id TEXT PRIMARY KEY, kind TEXT NOT NULL, ciphertext BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, data TEXT NOT NULL);
PRAGMA user_version = 1;`)
	if err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) Read() (Data, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return Data{}, err
	}
	defer tx.Rollback()
	d := Data{Groups: []Group{}, Connections: []Connection{}, Credentials: []Credential{}}
	for _, table := range []string{"groups", "connections"} {
		rows, err := tx.Query("SELECT data FROM " + table + " ORDER BY id")
		if err != nil {
			return Data{}, err
		}
		for rows.Next() {
			var b []byte
			if err = rows.Scan(&b); err != nil {
				rows.Close()
				return Data{}, err
			}
			if table == "groups" {
				var g Group
				err = json.Unmarshal(b, &g)
				d.Groups = append(d.Groups, g)
			} else {
				var c Connection
				err = json.Unmarshal(b, &c)
				d.Connections = append(d.Connections, c)
			}
			if err != nil {
				rows.Close()
				return Data{}, err
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return Data{}, err
		}
	}
	rows, err := tx.Query("SELECT id, kind, ciphertext FROM credentials ORDER BY id")
	if err != nil {
		return Data{}, err
	}
	for rows.Next() {
		var c Credential
		var ciphertext []byte
		if err = rows.Scan(&c.ID, &c.Kind, &ciphertext); err != nil {
			rows.Close()
			return Data{}, err
		}
		n := s.aead.NonceSize()
		if len(ciphertext) < n {
			rows.Close()
			return Data{}, errors.New("凭据密文损坏")
		}
		plain, err := s.aead.Open(nil, ciphertext[:n], ciphertext[n:], []byte(c.ID+":"+c.Kind))
		if err != nil {
			rows.Close()
			return Data{}, fmt.Errorf("凭据解密失败: %w", err)
		}
		c.Secret = string(plain)
		d.Credentials = append(d.Credentials, c)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return Data{}, err
	}
	return d, tx.Commit()
}

func (s *Store) Replace(d Data) error {
	return s.ReplaceWithSettings(d, nil)
}
func (s *Store) ReplaceWithSettings(d Data, settings map[string]string) error {
	if err := d.Validate(); err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, table := range []string{"connections", "groups", "credentials"} {
		if _, err = tx.Exec("DELETE FROM " + table); err != nil {
			return err
		}
	}
	for _, g := range d.Groups {
		b, err := json.Marshal(g)
		if err != nil {
			return err
		}
		if _, err = tx.Exec("INSERT INTO groups VALUES (?, ?)", g.ID, string(b)); err != nil {
			return err
		}
	}
	for _, c := range d.Connections {
		b, err := json.Marshal(c)
		if err != nil {
			return err
		}
		if _, err = tx.Exec("INSERT INTO connections VALUES (?, ?)", c.ID, string(b)); err != nil {
			return err
		}
	}
	for _, c := range d.Credentials {
		nonce := make([]byte, s.aead.NonceSize())
		if _, err = rand.Read(nonce); err != nil {
			return err
		}
		ciphertext := s.aead.Seal(nonce, nonce, []byte(c.Secret), []byte(c.ID+":"+c.Kind))
		if _, err = tx.Exec("INSERT INTO credentials VALUES (?, ?, ?)", c.ID, c.Kind, ciphertext); err != nil {
			return err
		}
	}
	for id, value := range settings {
		if _, err = tx.Exec("INSERT INTO settings(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data", id, value); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	if s.changed != nil {
		s.changed()
	}
	return nil
}
