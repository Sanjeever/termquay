package main

import (
	"embed"
	"encoding/json"
	"io/fs"
	"strings"
)

//go:embed frontend/package.json
var packageInfo []byte

//go:embed LICENSE THIRD_PARTY_NOTICES.md all:build/licenses
var licenseFiles embed.FS

var buildCommit string
var releaseBuild string

type BuildInfo struct {
	Version     string `json:"version"`
	Commit      string `json:"commit"`
	Development bool   `json:"development"`
}

func currentBuild() BuildInfo {
	var pkg struct{ Version string }
	if err := json.Unmarshal(packageInfo, &pkg); err != nil {
		panic(err)
	}
	return BuildInfo{Version: pkg.Version, Commit: buildCommit, Development: releaseBuild != "true"}
}

func (a *AppService) GetLicenseFiles() ([]string, error) {
	names := []string{"LICENSE", "THIRD_PARTY_NOTICES.md"}
	err := fs.WalkDir(licenseFiles, "build/licenses", func(path string, entry fs.DirEntry, err error) error {
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
	data, err := licenseFiles.ReadFile(name)
	return string(data), err
}
