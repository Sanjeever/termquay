package app

import (
	"encoding/base64"
	"runtime"
	"time"

	"github.com/Sanjeever/termquay/internal/store"
)

func (a *AppService) PuTTYImportAvailable() bool { return runtime.GOOS == "windows" }

func (a *AppService) PreviewPuTTYImport() (SSHImportPreview, error) {
	rows, warnings, err := readPuTTYSessions()
	if err != nil {
		return SSHImportPreview{}, err
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return SSHImportPreview{}, err
	}
	data, err := a.store.Read()
	if err != nil {
		return SSHImportPreview{}, err
	}
	preview := SSHImportPreview{ID: base64.RawURLEncoding.EncodeToString(randomBytes(18)), Rows: rows, Warnings: nil, base: data, expires: time.Now().Add(10 * time.Minute)}
	appendImportNotices(&preview.Warnings, &preview.WarningMessages, warnings...)
	names := map[string]string{}
	for _, connection := range data.Connections {
		if names[connection.Name] == "" {
			names[connection.Name] = connection.ID
		}
	}
	for index := range preview.Rows {
		preview.Rows[index].ID = base64.RawURLEncoding.EncodeToString(randomBytes(16))
		preview.Rows[index].Conflict = names[preview.Rows[index].Connection.Name]
	}
	a.importPreview = &preview
	return preview, nil
}

func puttyImportRow(name, host, username string, port int) SSHImportRow {
	return SSHImportRow{Connection: store.Connection{Name: name, Host: host, Username: username, Port: port, Protocol: "ssh", AuthMethod: "password"}, Warnings: []string{}}
}
