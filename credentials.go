package main

import (
	"encoding/json"
	"errors"
	"slices"

	terminal "github.com/Sanjeever/termquay/internal/ssh"
)

type CredentialReference struct {
	ID            string   `json:"id"`
	Kind          string   `json:"kind"`
	ConnectionIDs []string `json:"connection_ids"`
	Names         []string `json:"names"`
}

func (a *AppService) ListCredentialReferences() ([]CredentialReference, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return nil, err
	}
	data, err := a.store.Read()
	if err != nil {
		return nil, err
	}
	result := []CredentialReference{}
	indexes := map[string]int{}
	for _, credential := range data.Credentials {
		item := CredentialReference{ID: credential.ID, Kind: credential.Kind, ConnectionIDs: []string{}, Names: []string{}}
		indexes[item.ID] = len(result)
		result = append(result, item)
	}
	for _, connection := range data.Connections {
		if index, ok := indexes[connection.CredentialID]; ok {
			result[index].ConnectionIDs = append(result[index].ConnectionIDs, connection.ID)
			result[index].Names = append(result[index].Names, connection.Name)
		}
	}
	return result, nil
}

func (a *AppService) AssignCredential(connectionIDs []string, credentialID string) error {
	if len(connectionIDs) == 0 || len(connectionIDs) > 256 {
		return errors.New("请选择 1 至 256 个连接")
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return err
	}
	data, err := a.store.Read()
	if err != nil {
		return err
	}
	kind := ""
	for _, credential := range data.Credentials {
		if credential.ID == credentialID {
			kind = credential.Kind
			break
		}
	}
	if kind == "" {
		return errors.New("所选凭据不存在")
	}
	selected := map[string]bool{}
	for _, id := range connectionIDs {
		if selected[id] {
			return errors.New("连接选择重复")
		}
		selected[id] = true
	}
	for i, connection := range data.Connections {
		if !selected[connection.ID] {
			continue
		}
		if connection.Protocol == "rdp" && kind != "password" {
			return errors.New("RDP 不能使用私钥凭据")
		}
		data.Connections[i].CredentialID = credentialID
		if connection.Protocol == "ssh" {
			data.Connections[i].AuthMethod = kind
			if kind != "private_key" {
				data.Connections[i].Certificate = ""
			}
		}
		delete(selected, connection.ID)
	}
	if len(selected) > 0 {
		return errors.New("部分连接已失效")
	}
	used := map[string]bool{}
	for _, connection := range data.Connections {
		used[connection.CredentialID] = true
	}
	credentials := data.Credentials[:0]
	for _, credential := range data.Credentials {
		if used[credential.ID] {
			credentials = append(credentials, credential)
		}
	}
	data.Credentials = credentials
	return a.store.Replace(data)
}

func (a *AppService) UpdateCredential(id string, auth terminal.Request, expectedConnections []string) error {
	if err := a.resolvePrivateKey(&auth); err != nil {
		return err
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return err
	}
	data, err := a.store.Read()
	if err != nil {
		return err
	}
	actual := []string{}
	for _, connection := range data.Connections {
		if connection.CredentialID == id {
			actual = append(actual, connection.ID)
		}
	}
	slices.Sort(actual)
	slices.Sort(expectedConnections)
	if !slices.Equal(actual, expectedConnections) {
		return errors.New("凭据引用在预览后发生变化，请重新打开")
	}
	for i, credential := range data.Credentials {
		if credential.ID != id {
			continue
		}
		if credential.Kind == "password" {
			if auth.Password == "" || len(auth.Password) > 64<<10 {
				return errors.New("密码不能为空或超过 64 KiB")
			}
			data.Credentials[i].Secret = auth.Password
		} else {
			if auth.PrivateKey == "" || len(auth.PrivateKey) > 1<<20 {
				return errors.New("私钥不能为空或超过 1 MiB")
			}
			encoded, err := json.Marshal(struct {
				Key        string `json:"key"`
				Passphrase string `json:"passphrase"`
			}{auth.PrivateKey, auth.Passphrase})
			if err != nil {
				return err
			}
			data.Credentials[i].Secret = string(encoded)
		}
		return a.store.Replace(data)
	}
	return errors.New("凭据不存在")
}
