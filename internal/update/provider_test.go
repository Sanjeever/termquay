package update

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/updater"
)

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(request *http.Request) (*http.Response, error) { return f(request) }

func response(body string) *http.Response {
	return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Header: http.Header{}}
}

func releaseClient(t *testing.T, platform, tag, asset, checksums, downloadURL string, payload []byte, prerelease bool) *http.Client {
	t.Helper()
	return &http.Client{Transport: roundTrip(func(request *http.Request) (*http.Response, error) {
		if request.Context().Err() != nil {
			return nil, request.Context().Err()
		}
		if request.URL.Host == "api.github.com" {
			data, err := json.Marshal(map[string]any{
				"tag_name": tag, "prerelease": prerelease, "body": "## 修复\n\n- 保存文件。\n", "html_url": "https://example.com/untrusted",
				"assets": []map[string]any{
					{"name": "termquay_1.1.0_windows_amd64-installer.exe", "browser_download_url": "https://example.com/installer"},
					{"name": asset, "browser_download_url": downloadURL, "size": len(payload)},
					{"name": "SHA256SUMS", "browser_download_url": "https://github.com/" + Repository + "/releases/download/" + tag + "/SHA256SUMS"},
				},
			})
			if err != nil {
				t.Fatal(err)
			}
			return response(string(data)), nil
		}
		if strings.HasSuffix(request.URL.Path, "/SHA256SUMS") {
			return response(checksums), nil
		}
		return response(string(payload)), nil
	})}
}

func TestReleaseContract(t *testing.T) {
	for _, test := range []struct {
		name, platform, arch, tag, asset, digest, url string
		prerelease, wantError, available              bool
	}{
		{name: "Windows", platform: "windows", arch: "amd64", available: true},
		{name: "macOS arm64 使用 universal", platform: "darwin", arch: "arm64", available: true},
		{name: "macOS Intel 使用 universal", platform: "darwin", arch: "amd64", available: true},
		{name: "Linux", platform: "linux", arch: "amd64", available: true},
		{name: "同版本", platform: "windows", arch: "amd64", tag: "v1.0.0"},
		{name: "不支持的架构", platform: "windows", arch: "arm64", wantError: true},
		{name: "预发布", platform: "windows", arch: "amd64", prerelease: true, wantError: true},
		{name: "缺少摘要", platform: "windows", arch: "amd64", digest: "missing", wantError: true},
		{name: "错误摘要长度", platform: "windows", arch: "amd64", digest: "aa", wantError: true},
		{name: "版本附件不符", platform: "windows", arch: "amd64", asset: "termquay_1.2.0_windows_amd64.zip", wantError: true},
		{name: "外部附件", platform: "windows", arch: "amd64", url: "https://example.com/update.zip", wantError: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			tag := test.tag
			if tag == "" {
				tag = "v1.1.0"
			}
			asset := "termquay_" + strings.TrimPrefix(tag, "v") + "_" + test.platform + "_amd64.zip"
			if test.platform == "darwin" {
				asset = "termquay_" + strings.TrimPrefix(tag, "v") + "_darwin_universal.zip"
			} else if test.platform == "linux" {
				asset = strings.TrimSuffix(asset, ".zip") + ".tar.gz"
			}
			if test.asset != "" {
				asset = test.asset
			}
			digest := test.digest
			if digest == "" {
				digest = strings.Repeat("ab", 32)
			}
			url := test.url
			if url == "" {
				url = "https://github.com/" + Repository + "/releases/download/" + tag + "/" + asset
			}
			checksum := digest + "  " + asset + "\n"
			if digest == "missing" {
				checksum = ""
			}
			client := releaseClient(t, test.platform, tag, asset, checksum, url, nil, test.prerelease)
			provider, err := New(client)
			if err != nil {
				t.Fatal(err)
			}
			release, err := provider.Check(context.Background(), updater.CheckRequest{CurrentVersion: "1.0.0", Platform: test.platform, Arch: test.arch})
			if (err != nil) != test.wantError || (release != nil) != test.available {
				t.Fatalf("release=%+v error=%v", release, err)
			}
			if release != nil && (release.Notes != "## 修复\n\n- 保存文件。\n" || release.Metadata["github.release.htmlURL"] != "https://github.com/"+Repository+"/releases/tag/"+tag) {
				t.Fatal("更新日志或发布页面不符合约定")
			}
		})
	}
}

type testHost struct{ updater.Host }

func (*testHost) Emit(string, ...any) bool         { return true }
func (*testHost) OnEvent(string, func(any)) func() { return func() {} }
func (*testHost) OpenWindow(updater.WindowOptions) updater.WindowHandle {
	panic("更新不能打开框架窗口")
}
func (*testHost) Quit() { panic("下载不能退出应用") }

func TestDownloadRequiresMatchingDigestAndSinglePayload(t *testing.T) {
	for _, test := range []struct {
		name, digest string
		extra        bool
		wantError    bool
	}{
		{name: "单程序压缩包"},
		{name: "摘要不符", digest: strings.Repeat("ab", 32), wantError: true},
		{name: "包内旁置文件", extra: true, wantError: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			var archive bytes.Buffer
			writer := zip.NewWriter(&archive)
			file, err := writer.Create("termquay.exe")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := file.Write([]byte("test program")); err != nil {
				t.Fatal(err)
			}
			if test.extra {
				if _, err := writer.Create("LICENSE"); err != nil {
					t.Fatal(err)
				}
			}
			if err := writer.Close(); err != nil {
				t.Fatal(err)
			}
			asset := "termquay_1.1.0_windows_amd64.zip"
			digest := sha256.Sum256(archive.Bytes())
			checksum := test.digest
			if checksum == "" {
				checksum = hex.EncodeToString(digest[:])
			}
			provider, err := New(releaseClient(t, "windows", "v1.1.0", asset, checksum+"  "+asset, "https://github.com/"+Repository+"/releases/download/v1.1.0/"+asset, archive.Bytes(), false))
			if err != nil {
				t.Fatal(err)
			}
			engine := updater.New(&testHost{})
			if err := engine.Init(updater.Config{CurrentVersion: "1.0.0", Platform: "windows", Arch: "amd64", Providers: []updater.Provider{provider}, Window: updater.WindowNone}); err != nil {
				t.Fatal(err)
			}
			if _, err := engine.Check(context.Background()); err != nil {
				t.Fatal(err)
			}
			err = engine.DownloadAndInstall(context.Background())
			if (err != nil) != test.wantError {
				t.Fatalf("download error=%v", err)
			}
			if !test.wantError {
				path := engine.DownloadedPath()
				if engine.State() != updater.StateReady || filepath.Base(path) != "termquay.exe" {
					t.Fatalf("state=%s path=%s", engine.State(), path)
				}
				t.Cleanup(func() {
					if strings.HasPrefix(filepath.Base(filepath.Dir(path)), "wails-update-") {
						if err := os.RemoveAll(filepath.Dir(path)); err != nil {
							t.Error(err)
						}
					}
				})
			}
		})
	}
}

func TestCheckCancellation(t *testing.T) {
	provider, err := New(&http.Client{Transport: roundTrip(func(request *http.Request) (*http.Response, error) {
		<-request.Context().Done()
		return nil, request.Context().Err()
	})})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := provider.Check(ctx, updater.CheckRequest{CurrentVersion: "1.0.0", Platform: "windows", Arch: "amd64"}); err == nil {
		t.Fatal("取消后检查仍成功")
	}
}
