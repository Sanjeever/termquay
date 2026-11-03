package app

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/updater"
)

type updateTestHost struct{ updater.Host }

func (*updateTestHost) Emit(string, ...any) bool         { return true }
func (*updateTestHost) OnEvent(string, func(any)) func() { return func() {} }

type updateTestProvider struct{ payload []byte }

func (p updateTestProvider) Name() string { return "test" }
func (p updateTestProvider) Check(context.Context, updater.CheckRequest) (*updater.Release, error) {
	digest := sha256.Sum256(p.payload)
	return &updater.Release{Version: "1.0.1", Artifact: updater.Artifact{Filename: "termquay.zip"}, Verification: &updater.Verification{DigestAlgo: "sha256", Digest: digest[:]}}, nil
}
func (p updateTestProvider) Download(_ context.Context, _ *updater.Release, target io.Writer, _ func(int64, int64)) error {
	_, err := target.Write(p.payload)
	return err
}

func TestShutdownOwnsOnlyUnclaimedUpdateStaging(t *testing.T) {
	for _, handedOff := range []bool{false, true} {
		t.Run(map[bool]string{false: "普通退出清理暂存", true: "辅助进程已接管暂存"}[handedOff], func(t *testing.T) {
			var archive bytes.Buffer
			writer := zip.NewWriter(&archive)
			entry, err := writer.Create("termquay")
			if err != nil {
				t.Fatal(err)
			}
			if _, err = entry.Write([]byte("test program")); err != nil {
				t.Fatal(err)
			}
			if err = writer.Close(); err != nil {
				t.Fatal(err)
			}
			engine := updater.New(&updateTestHost{})
			if err = engine.Init(updater.Config{CurrentVersion: "1.0.0", Providers: []updater.Provider{updateTestProvider{archive.Bytes()}}, Window: updater.WindowNone}); err != nil {
				t.Fatal(err)
			}
			if _, err = engine.Check(context.Background()); err != nil {
				t.Fatal(err)
			}
			if err = engine.DownloadAndInstall(context.Background()); err != nil {
				t.Fatal(err)
			}
			path := engine.DownloadedPath()
			directory := filepath.Dir(path)
			if !strings.HasPrefix(filepath.Base(directory), "wails-update-") {
				t.Fatal("框架暂存路径不符合约定")
			}
			t.Cleanup(func() {
				if err := os.RemoveAll(directory); err != nil {
					t.Error(err)
				}
			})
			service := NewAppService(BuildInfo{Development: true}, nil)
			service.updateEngine = engine
			service.updateRestarting = handedOff
			if err := service.stopUpdates(); err != nil {
				t.Fatal(err)
			}
			_, err = os.Stat(path)
			if handedOff && err != nil || !handedOff && !os.IsNotExist(err) {
				t.Fatalf("handedOff=%v, stat=%v", handedOff, err)
			}
		})
	}
}
