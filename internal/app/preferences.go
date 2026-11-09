package app

import (
	"path"
	"sort"
	"strings"
	"time"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	"github.com/Sanjeever/termquay/internal/store"
)

func (a *AppService) connectionPreferences() (map[string]store.ConnectionPreference, error) {
	if err := a.openStorage(); err != nil {
		return nil, err
	}
	valid, err := a.store.ConnectionIDs()
	if err != nil {
		return nil, err
	}
	preferences, err := a.store.ConnectionPreferences()
	if err != nil {
		return nil, err
	}
	removed := false
	for id := range preferences {
		if !valid[id] {
			delete(preferences, id)
			removed = true
		}
	}
	if removed {
		if err := a.store.SetConnectionPreferences(preferences); err != nil {
			return nil, err
		}
	}
	return preferences, nil
}

func (a *AppService) GetConnectionPreferences() (map[string]store.ConnectionPreference, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	return a.connectionPreferences()
}

func (a *AppService) SetDockerSocket(id, socket string) error {
	if socket != "" && (!path.IsAbs(socket) || path.Clean(socket) != socket || len(socket) > 4096 || strings.ContainsAny(socket, "\x00\r\n")) {
		return appmessage.New("backend:dockerSocketMustBeAnAbsoluteRemoteUnix", "Docker socket 必须是远端 Unix 绝对路径")
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	preferences, err := a.connectionPreferences()
	if err != nil {
		return err
	}
	data, err := a.store.Read()
	if err != nil {
		return err
	}
	for _, connection := range data.Connections {
		if connection.ID == id && connection.Protocol == "ssh" {
			value := preferences[id]
			value.DockerSocket = socket
			preferences[id] = value
			return a.store.SetConnectionPreferences(preferences)
		}
	}
	return appmessage.New("backend:connectionDoesNotExist", "连接不存在")
}

func (a *AppService) SetConnectionPreference(id string, favorite bool, environment string) error {
	if environment != "" && environment != "production" && environment != "staging" && environment != "development" {
		return appmessage.New("backend:invalidEnvironmentIdentifier", "环境标识无效")
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	preferences, err := a.connectionPreferences()
	if err != nil {
		return err
	}
	d, err := a.store.Read()
	if err != nil {
		return err
	}
	for _, c := range d.Connections {
		if c.ID == id {
			p := preferences[id]
			p.Favorite = favorite
			p.Environment = environment
			preferences[id] = p
			return a.store.SetConnectionPreferences(preferences)
		}
	}
	return appmessage.New("backend:connectionDoesNotExist", "连接不存在")
}

func validateConnectionTags(tags []string) error {
	if len(tags) > 16 {
		return appmessage.New("backend:aConnectionSupportsUpTo16Tags", "每个连接最多 16 个标签")
	}
	seen := map[string]bool{}
	for _, tag := range tags {
		if tag == "" || tag != strings.TrimSpace(tag) || len(tag) > 64 || strings.ContainsAny(tag, ",，\r\n\x00") || seen[tag] {
			return appmessage.New("backend:tagsMustBeUniqueTextFrom1To", "标签须为不重复的 1 至 64 字节文本，不含逗号或换行")
		}
		seen[tag] = true
	}
	return nil
}

func (a *AppService) SetConnectionTags(id string, tags []string) error {
	if err := validateConnectionTags(tags); err != nil {
		return err
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	preferences, err := a.connectionPreferences()
	if err != nil {
		return err
	}
	data, err := a.store.Read()
	if err != nil {
		return err
	}
	for _, connection := range data.Connections {
		if connection.ID == id {
			value := preferences[id]
			value.Tags = tags
			preferences[id] = value
			return a.store.SetConnectionPreferences(preferences)
		}
	}
	return appmessage.New("backend:connectionDoesNotExist", "连接不存在")
}

func (a *AppService) RecordConnectionSuccess(id string) error {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	preferences, err := a.connectionPreferences()
	if err != nil {
		return err
	}
	d, err := a.store.Read()
	if err != nil {
		return err
	}
	found := false
	for _, c := range d.Connections {
		if c.ID == id {
			found = true
			break
		}
	}
	if !found {
		return appmessage.New("backend:connectionDoesNotExist", "连接不存在")
	}
	now := time.Now().UTC()
	p := preferences[id]
	p.LastConnected = &now
	preferences[id] = p
	recent := []string{}
	for key, value := range preferences {
		if value.LastConnected != nil {
			recent = append(recent, key)
		}
	}
	sort.Slice(recent, func(i, j int) bool {
		return preferences[recent[i]].LastConnected.After(*preferences[recent[j]].LastConnected)
	})
	for _, key := range recent[min(50, len(recent)):] {
		value := preferences[key]
		value.LastConnected = nil
		preferences[key] = value
	}
	return a.store.SetConnectionPreferences(preferences)
}

func (a *AppService) ClearRecentConnections() error {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	preferences, err := a.connectionPreferences()
	if err != nil {
		return err
	}
	for id, p := range preferences {
		p.LastConnected = nil
		preferences[id] = p
	}
	return a.store.SetConnectionPreferences(preferences)
}

func (a *AppService) SetRDPResolution(id, resolution string) error {
	if resolution != "dynamic" && resolution != "1280x800" && resolution != "1920x1080" && resolution != "multimon" {
		return appmessage.New("backend:invalidRemoteResolution", "远程分辨率无效")
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	preferences, err := a.connectionPreferences()
	if err != nil {
		return err
	}
	d, err := a.store.Read()
	if err != nil {
		return err
	}
	for _, c := range d.Connections {
		if c.ID == id && c.Protocol == "rdp" {
			p := preferences[id]
			p.RDPResolution = resolution
			preferences[id] = p
			return a.store.SetConnectionPreferences(preferences)
		}
	}
	return appmessage.New("backend:rDPConnectionDoesNotExist", "RDP 连接不存在")
}

func (a *AppService) GetDirectoryBookmarks(id string) ([]string, error) {
	p, err := a.GetConnectionPreferences()
	if err != nil {
		return nil, err
	}
	return p[id].Bookmarks, nil
}

func (a *AppService) SetRDPClient(id, client string) error {
	if client != "internal" && client != "system" {
		return appmessage.New("backend:invalidRDPClientType", "RDP 连接方式无效")
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	preferences, err := a.connectionPreferences()
	if err != nil {
		return err
	}
	data, err := a.store.Read()
	if err != nil {
		return err
	}
	for _, connection := range data.Connections {
		if connection.ID == id && connection.Protocol == "rdp" {
			preference := preferences[id]
			preference.RDPClient = client
			preferences[id] = preference
			return a.store.SetConnectionPreferences(preferences)
		}
	}
	return appmessage.New("backend:rDPConnectionDoesNotExist", "RDP 连接不存在")
}
func (a *AppService) SetDirectoryBookmarks(id string, bookmarks []string) error {
	if len(bookmarks) > 32 {
		return appmessage.New("backend:directoryBookmarkLimitReached32", "目录书签达到上限（32 个）")
	}
	seen := map[string]bool{}
	for _, value := range bookmarks {
		if len(value) > 4096 || !path.IsAbs(value) || path.Clean(value) != value || seen[value] {
			return appmessage.New("backend:invalidOrDuplicateDirectoryBookmark", "目录书签无效或重复")
		}
		seen[value] = true
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	p, err := a.connectionPreferences()
	if err != nil {
		return err
	}
	d, err := a.store.Read()
	if err != nil {
		return err
	}
	for _, c := range d.Connections {
		if c.ID == id {
			value := p[id]
			value.Bookmarks = bookmarks
			p[id] = value
			return a.store.SetConnectionPreferences(p)
		}
	}
	return appmessage.New("backend:connectionDoesNotExist", "连接不存在")
}
