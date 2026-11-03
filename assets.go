package main

import (
	"embed"
	"encoding/json"

	"github.com/Sanjeever/termquay/internal/app"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/appicon.png build/darwin/appicon.png
var appIcons embed.FS

//go:embed frontend/package.json
var packageInfo []byte

//go:embed LICENSE THIRD_PARTY_NOTICES.md all:build/licenses
var licenseFiles embed.FS

var buildCommit string
var releaseBuild string

func currentBuild() app.BuildInfo {
	var pkg struct{ Version string }
	if err := json.Unmarshal(packageInfo, &pkg); err != nil {
		panic(err)
	}
	return app.BuildInfo{Version: pkg.Version, Commit: buildCommit, Development: releaseBuild != "true"}
}
