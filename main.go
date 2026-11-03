package main

import (
	"log"

	"github.com/Sanjeever/termquay/internal/app"
)

func main() {
	if err := app.Run(assets, appIcons, currentBuild(), licenseFiles); err != nil {
		log.Fatal(err)
	}
}
