package update

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/updater"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/github"
)

const Repository = "Sanjeever/termquay"

var versionPattern = regexp.MustCompile(`^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$`)
var assetPattern = regexp.MustCompile(`^termquay_(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)_(windows_amd64\.zip|darwin_universal\.zip|linux_amd64\.tar\.gz)$`)

type Provider struct{ *github.Provider }

func New(client *http.Client) (*Provider, error) {
	p, err := github.New(github.Config{
		Repository: Repository, HTTPClient: client, ChecksumAsset: "SHA256SUMS",
		AssetMatcher: func(request updater.CheckRequest, assets []github.ReleaseAsset) int {
			suffix := "_" + request.Platform + "_" + request.Arch + ".zip"
			if request.Platform == "darwin" {
				suffix = "_darwin_universal.zip"
			} else if request.Platform == "linux" {
				suffix = "_linux_" + request.Arch + ".tar.gz"
			}
			for i, asset := range assets {
				if assetPattern.MatchString(asset.Name) && strings.HasSuffix(asset.Name, suffix) {
					return i
				}
			}
			return -1
		},
	})
	if err != nil {
		return nil, err
	}
	return &Provider{p}, nil
}

func (p *Provider) Check(ctx context.Context, request updater.CheckRequest) (*updater.Release, error) {
	release, err := p.Provider.Check(ctx, request)
	if err != nil || release == nil {
		return release, err
	}
	if release.Channel != "stable" || !versionPattern.MatchString(release.Version) || !strings.HasPrefix(release.Artifact.Filename, "termquay_"+release.Version+"_") {
		return nil, errors.New("更新来源版本与附件不一致")
	}
	u, err := url.Parse(fmt.Sprint(release.Metadata["github.asset.url"]))
	if err != nil || u.Scheme != "https" || u.Host != "github.com" || u.User != nil || !strings.HasPrefix(u.Path, "/"+Repository+"/releases/download/v"+release.Version+"/") {
		return nil, errors.New("更新附件地址不属于本项目")
	}
	if release.Verification == nil || release.Verification.DigestAlgo != "sha256" || len(release.Verification.Digest) != 32 {
		return nil, errors.New("更新缺少有效的 SHA256SUMS 校验记录")
	}
	release.Metadata["github.release.htmlURL"] = "https://github.com/" + Repository + "/releases/tag/v" + release.Version
	return release, nil
}
