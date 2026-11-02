package main

import (
	"errors"
	"sort"
	"time"

	"github.com/Sanjeever/termquay/internal/store"
)

func (a *AppService) connectionPreferences() (map[string]store.ConnectionPreference, error) {
	if err := a.openStorage(); err != nil {
		return nil, err
	}
	d, err := a.store.Read()
	if err != nil {
		return nil, err
	}
	preferences, err := a.store.ConnectionPreferences()
	if err != nil {
		return nil, err
	}
	valid := make(map[string]bool, len(d.Connections))
	for _, c := range d.Connections {
		valid[c.ID] = true
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

func (a *AppService) SetConnectionPreference(id string, favorite bool, environment string) error {
	if environment != "" && environment != "production" && environment != "staging" && environment != "development" {
		return errors.New("环境标识无效")
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
	return errors.New("连接不存在")
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
		return errors.New("连接不存在")
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
	if resolution != "dynamic" && resolution != "1280x800" && resolution != "1920x1080" {
		return errors.New("远程分辨率无效")
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
	return errors.New("RDP 连接不存在")
}
