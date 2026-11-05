package main

import (
	"context"
	"github.com/Sanjeever/termquay/internal/cli"
	"log"
	"os"
	"os/signal"

	"github.com/Sanjeever/termquay/internal/app"
)

func main() {
	if len(os.Args) > 1 {
		cli.PrepareConsole()
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
		stopInput := context.AfterFunc(ctx, func() { os.Stdin.Close() })
		code := cli.Run(ctx, os.Args[1:], currentBuild().Version, os.Stdin, os.Stdout, os.Stderr)
		stopInput()
		stop()
		os.Exit(code)
	}
	if err := app.Run(assets, appIcons, currentBuild(), licenseFiles); err != nil {
		log.Fatal(err)
	}
}
