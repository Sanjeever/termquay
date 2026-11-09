package store

import (
	"encoding/json"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	"reflect"
	"time"
)

type ConnectionPreference struct {
	Favorite       bool       `json:"favorite"`
	Environment    string     `json:"environment"`
	Tags           []string   `json:"tags,omitempty"`
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
	previous, err := s.ConnectionPreferences()
	if err != nil {
		return err
	}
	value, err := json.Marshal(preferences)
	if err != nil {
		return err
	}
	if len(value) > 1<<20 {
		return appmessage.New("backend:connectionPreferencesExceed1MiB", "连接偏好超过 1 MiB 上限")
	}
	if err := s.SetSetting("connection_preferences", string(value)); err != nil {
		return err
	}
	portable := func(values map[string]ConnectionPreference) map[string]ConnectionPreference {
		result := map[string]ConnectionPreference{}
		for id, item := range values {
			item.LastConnected = nil
			if !reflect.DeepEqual(item, ConnectionPreference{}) {
				result[id] = item
			}
		}
		return result
	}
	if s.changed != nil && !reflect.DeepEqual(portable(previous), portable(preferences)) {
		s.changed()
	}
	return nil
}
