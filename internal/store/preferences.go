package store

import (
	"encoding/json"
	"errors"
	"time"
)

type ConnectionPreference struct {
	Favorite       bool       `json:"favorite"`
	Environment    string     `json:"environment"`
	RDPResolution  string     `json:"rdp_resolution,omitempty"`
	RDPClient      string     `json:"rdp_client,omitempty"`
	Bookmarks      []string   `json:"bookmarks,omitempty"`
	PrivateKeyPath string     `json:"private_key_path,omitempty"`
	LastConnected  *time.Time `json:"last_connected,omitempty"`
}

func (s *Store) ConnectionPreferences() (map[string]ConnectionPreference, error) {
	value, err := s.Setting("connection_preferences")
	if err != nil {
		return nil, err
	}
	preferences := map[string]ConnectionPreference{}
	if value != "" {
		err = json.Unmarshal([]byte(value), &preferences)
	}
	return preferences, err
}

func (s *Store) SetConnectionPreferences(preferences map[string]ConnectionPreference) error {
	value, err := json.Marshal(preferences)
	if err != nil {
		return err
	}
	if len(value) > 1<<20 {
		return errors.New("连接偏好超过 1 MiB 上限")
	}
	return s.SetSetting("connection_preferences", string(value))
}
