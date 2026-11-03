package main

import (
	"encoding/base64"
	"errors"

	"github.com/Sanjeever/termquay/internal/store"
)

type BackupSelection struct {
	ConnectionIDs []string `json:"connection_ids"`
	Credentials   bool     `json:"credentials"`
	Snippets      bool     `json:"snippets"`
	Settings      bool     `json:"settings"`
}

func selectSnapshotData(data store.Data, ids []string) (store.Data, error) {
	if len(ids) == 0 || len(ids) > 256 {
		return store.Data{}, errors.New("请选择 1 至 256 个连接")
	}
	connections := map[string]store.Connection{}
	for _, c := range data.Connections {
		connections[c.ID] = c
	}
	chosen := map[string]bool{}
	var choose func(string) error
	choose = func(id string) error {
		if chosen[id] {
			return nil
		}
		c, ok := connections[id]
		if !ok {
			return errors.New("所选连接不存在")
		}
		chosen[id] = true
		if c.JumpID != "" {
			return choose(c.JumpID)
		}
		return nil
	}
	for _, id := range ids {
		if err := choose(id); err != nil {
			return store.Data{}, err
		}
	}
	groups := map[string]store.Group{}
	for _, g := range data.Groups {
		groups[g.ID] = g
	}
	groupIDs, credentialIDs := map[string]bool{}, map[string]bool{}
	result := store.Data{Groups: []store.Group{}, Connections: []store.Connection{}, Credentials: []store.Credential{}}
	for _, c := range data.Connections {
		if !chosen[c.ID] {
			continue
		}
		result.Connections = append(result.Connections, c)
		credentialIDs[c.CredentialID] = true
		for id := c.GroupID; id != "" && !groupIDs[id]; id = groups[id].ParentID {
			groupIDs[id] = true
		}
	}
	for _, g := range data.Groups {
		if groupIDs[g.ID] {
			result.Groups = append(result.Groups, g)
		}
	}
	for _, c := range data.Credentials {
		if credentialIDs[c.ID] {
			result.Credentials = append(result.Credentials, c)
		}
	}
	return result, result.Validate()
}

func mergeSnapshotCopies(current, imported store.Data) store.Data {
	ids := map[string]string{}
	newID := func(id string) string {
		if id == "" {
			return ""
		}
		if ids[id] == "" {
			ids[id] = base64.RawURLEncoding.EncodeToString(randomBytes(16))
		}
		return ids[id]
	}
	for _, group := range imported.Groups {
		group.ID, group.ParentID = newID(group.ID), newID(group.ParentID)
		current.Groups = append(current.Groups, group)
	}
	for _, credential := range imported.Credentials {
		credential.ID = newID(credential.ID)
		current.Credentials = append(current.Credentials, credential)
	}
	for _, connection := range imported.Connections {
		connection.ID, connection.GroupID, connection.CredentialID, connection.JumpID = newID(connection.ID), newID(connection.GroupID), newID(connection.CredentialID), newID(connection.JumpID)
		current.Connections = append(current.Connections, connection)
	}
	return current
}
