package app

import (
	"encoding/base64"
	"encoding/json"

	appmessage "github.com/Sanjeever/termquay/internal/message"
)

type Snippet struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Group string `json:"group"`
	Body  string `json:"body"`
}

func (a *AppService) snippets() ([]Snippet, error) {
	if err := a.openStorage(); err != nil {
		return nil, err
	}
	value, err := a.store.SecretSetting("snippets")
	if err != nil {
		return nil, err
	}
	if len(value) > 1<<20 {
		return nil, appmessage.New("backend:snippetStorageExceeds1MiB", "片段存储超过 1 MiB 上限")
	}
	result := []Snippet{}
	if value != "" {
		err = json.Unmarshal([]byte(value), &result)
	}
	return result, err
}
func (a *AppService) ListSnippets() ([]Snippet, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	return a.snippets()
}
func (a *AppService) SaveSnippet(value Snippet) (Snippet, error) {
	if value.Name == "" || value.Body == "" || len(value.Name) > 128 || len(value.Group) > 128 || len(value.Body) > 32<<10 {
		return Snippet{}, appmessage.New("backend:snippetNameGroupOrBodyExceedsTheLimit", "片段名称、分组或正文超过限制")
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	values, err := a.snippets()
	if err != nil {
		return Snippet{}, err
	}
	found := false
	if value.ID != "" {
		for i, old := range values {
			if old.ID == value.ID {
				values[i] = value
				found = true
				break
			}
		}
		if !found {
			return Snippet{}, appmessage.New("backend:snippetDoesNotExist", "片段不存在")
		}
	} else {
		if len(values) >= 128 {
			return Snippet{}, appmessage.New("backend:snippetLimitReached128", "片段达到上限（128 个）")
		}
		value.ID = base64.RawURLEncoding.EncodeToString(randomBytes(16))
		values = append(values, value)
	}
	encoded, err := json.Marshal(values)
	if err != nil {
		return Snippet{}, err
	}
	if len(encoded) > 1<<20 {
		return Snippet{}, appmessage.New("backend:snippetsExceed1MiBInTotal", "片段总量超过 1 MiB 上限")
	}
	if err = a.store.SetSecretSetting("snippets", string(encoded)); err != nil {
		return Snippet{}, err
	}
	return value, nil
}
func (a *AppService) DeleteSnippet(id string) error {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	values, err := a.snippets()
	if err != nil {
		return err
	}
	found := false
	next := values[:0]
	for _, value := range values {
		if value.ID == id {
			found = true
		} else {
			next = append(next, value)
		}
	}
	if !found {
		return appmessage.New("backend:snippetDoesNotExist", "片段不存在")
	}
	encoded, err := json.Marshal(next)
	if err != nil {
		return err
	}
	return a.store.SetSecretSetting("snippets", string(encoded))
}
