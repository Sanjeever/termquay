package app

import (
	"io/fs"
	"strings"
)

type BuildInfo struct {
	Version     string `json:"version"`
	Commit      string `json:"commit"`
	Development bool   `json:"development"`
}

func (a *AppService) GetLicenseFiles() ([]string, error) {
	names := []string{"LICENSE", "THIRD_PARTY_NOTICES.md"}
	err := fs.WalkDir(a.licenseFiles, "build/licenses", func(path string, entry fs.DirEntry, err error) error {
		if err == nil && !entry.IsDir() {
			names = append(names, path)
		}
		return err
	})
	return names, err
}

func (a *AppService) GetLicenseText(name string) (string, error) {
	if name != "LICENSE" && name != "THIRD_PARTY_NOTICES.md" && !strings.HasPrefix(name, "build/licenses/") {
		return "", fs.ErrNotExist
	}
	data, err := a.licenseFiles.ReadFile(name)
	return string(data), err
}
