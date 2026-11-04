package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"image"
	"image/draw"
	"image/gif"
	_ "image/jpeg"
	"image/png"
	"io"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"

	_ "golang.org/x/image/webp"
)

const maxImageBytes = 16 << 20
const maxImagePixels = 16 << 20
const imageCacheBytes = 32 << 20
const imageCachePixels = 32 << 20
const imagePreviewRoute = "/termquay/image/"

type ImagePreview struct {
	ID     string `json:"id"`
	URL    string `json:"url"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Size   int64  `json:"size"`
	Format string `json:"format"`
}

type imagePreviewData struct {
	workspace string
	data      []byte
	width     int
	height    int
	mime      string
	expiry    *time.Timer
}

func (a *AppService) imageContext(ctx context.Context, id string) (context.Context, func(), *workspaceOwner, error) {
	a.mu.Lock()
	owner := a.workspaces[id]
	if owner == nil || a.closed {
		a.mu.Unlock()
		return nil, nil, nil, errors.New("SSH 工作区已关闭")
	}
	a.mu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	stop := context.AfterFunc(owner.ctx, cancel)
	a.imageMu.Lock()
	if a.imagePending >= 32 {
		a.imageMu.Unlock()
		stop()
		cancel()
		return nil, nil, nil, errors.New("图片读取任务达到上限，请稍后重试")
	}
	a.imagePending++
	a.imageMu.Unlock()
	release := func() {
		stop()
		cancel()
		a.imageMu.Lock()
		a.imagePending--
		a.imageMu.Unlock()
	}
	select {
	case a.imageSlots <- struct{}{}:
		return ctx, func() { <-a.imageSlots; release() }, owner, nil
	case <-ctx.Done():
		release()
		return nil, nil, nil, ctx.Err()
	}
}

func (a *AppService) PrepareImagePreview(ctx context.Context, id, remote string) (ImagePreview, error) {
	if !path.IsAbs(remote) || len(remote) > 4096 {
		return ImagePreview{}, errors.New("图片路径必须为远端绝对路径")
	}
	ctx, release, owner, err := a.imageContext(ctx, id)
	if err != nil {
		return ImagePreview{}, err
	}
	defer release()
	client, close, err := a.fileClient(ctx, id)
	if err != nil {
		return ImagePreview{}, err
	}
	defer close()
	info, err := client.Lstat(remote)
	if err != nil {
		return ImagePreview{}, err
	}
	if !info.Mode().IsRegular() {
		return ImagePreview{}, errors.New("图片预览支持普通文件，符号链接请使用实际目标路径")
	}
	if info.Size() > maxImageBytes {
		return ImagePreview{}, errors.New("图片超过 16 MiB，请下载后查看")
	}
	file, err := client.Open(remote)
	if err != nil {
		return ImagePreview{}, err
	}
	defer file.Close()
	data, err := readImageBytes(file)
	if err != nil {
		return ImagePreview{}, err
	}
	return a.publishImage(ctx, id, owner, data)
}

func (a *AppService) PrepareExternalImagePreview(ctx context.Context, id, address string) (ImagePreview, error) {
	u, err := url.Parse(address)
	if err != nil || u.Host == "" || u.User != nil || (u.Scheme != "http" && u.Scheme != "https") || len(address) > 8192 {
		return ImagePreview{}, errors.New("外部图片地址必须为 HTTP 或 HTTPS")
	}
	ctx, release, owner, err := a.imageContext(ctx, id)
	if err != nil {
		return ImagePreview{}, err
	}
	defer release()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return ImagePreview{}, err
	}
	client := &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(request *http.Request, previous []*http.Request) error {
		if len(previous) >= 5 || request.URL.User != nil || (request.URL.Scheme != "http" && request.URL.Scheme != "https") {
			return errors.New("外部图片重定向无效或超过限制")
		}
		return nil
	}}
	response, err := client.Do(request)
	if err != nil {
		var requestError *url.Error
		if errors.As(err, &requestError) {
			err = requestError.Err
		}
		return ImagePreview{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return ImagePreview{}, fmt.Errorf("外部图片读取失败：HTTP %d", response.StatusCode)
	}
	if response.ContentLength > maxImageBytes {
		return ImagePreview{}, errors.New("图片超过 16 MiB，请下载后查看")
	}
	data, err := readImageBytes(response.Body)
	if err != nil {
		return ImagePreview{}, err
	}
	return a.publishImage(ctx, id, owner, data)
}

func readImageBytes(reader io.Reader) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(reader, maxImageBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxImageBytes {
		return nil, errors.New("图片超过 16 MiB，请下载后查看")
	}
	return data, nil
}

func (a *AppService) publishImage(ctx context.Context, workspace string, owner *workspaceOwner, data []byte) (ImagePreview, error) {
	if err := ctx.Err(); err != nil {
		return ImagePreview{}, err
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return ImagePreview{}, errors.New("无法识别图片，预览支持 PNG、JPEG、GIF 和 WebP")
	}
	if config.Width <= 0 || config.Height <= 0 || config.Width > 16384 || config.Height > 16384 || int64(config.Width)*int64(config.Height) > maxImagePixels {
		return ImagePreview{}, errors.New("图片像素或尺寸超过预览限制，请下载后查看")
	}
	size := int64(len(data))
	mime := map[string]string{"png": "image/png", "jpeg": "image/jpeg", "gif": "image/png", "webp": "image/webp"}[format]
	if mime == "" {
		return ImagePreview{}, errors.New("图片格式暂不支持预览")
	}
	if format == "gif" {
		frame, err := gif.Decode(bytes.NewReader(data))
		if err != nil {
			return ImagePreview{}, fmt.Errorf("读取 GIF 首帧失败：%w", err)
		}
		var output bytes.Buffer
		canvas := image.NewNRGBA(image.Rect(0, 0, config.Width, config.Height))
		draw.Draw(canvas, frame.Bounds(), frame, frame.Bounds().Min, draw.Src)
		if err := png.Encode(&output, canvas); err != nil {
			return ImagePreview{}, err
		}
		data = output.Bytes()
	}
	if err := ctx.Err(); err != nil {
		return ImagePreview{}, err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closed || a.workspaces[workspace] != owner {
		return ImagePreview{}, errors.New("SSH 工作区已关闭")
	}
	a.imageMu.Lock()
	defer a.imageMu.Unlock()
	pixels := int64(config.Width) * int64(config.Height)
	if len(a.imagePreviews) >= 64 || a.imageBytes+int64(len(data)) > imageCacheBytes || a.imagePixels+pixels > imageCachePixels {
		return ImagePreview{}, errors.New("图片预览资源达到上限，请关闭其他图片或收起预览后重试")
	}
	if a.imagePreviews == nil {
		a.imagePreviews = map[string]*imagePreviewData{}
	}
	id := base64.RawURLEncoding.EncodeToString(randomBytes(32))
	a.imagePreviews[id] = &imagePreviewData{workspace: workspace, data: data, width: config.Width, height: config.Height, mime: mime, expiry: time.AfterFunc(30*time.Second, func() { a.ReleaseImagePreview(id) })}
	a.imageBytes += int64(len(data))
	a.imagePixels += pixels
	return ImagePreview{ID: id, URL: imagePreviewRoute, Width: config.Width, Height: config.Height, Size: size, Format: format}, nil
}

func (a *AppService) ReleaseImagePreview(id string) {
	a.imageMu.Lock()
	defer a.imageMu.Unlock()
	a.releaseImageLocked(id)
}

func (a *AppService) releaseImageLocked(id string) {
	if image := a.imagePreviews[id]; image != nil {
		if image.expiry != nil {
			image.expiry.Stop()
		}
		a.imageBytes -= int64(len(image.data))
		a.imagePixels -= int64(image.width) * int64(image.height)
		delete(a.imagePreviews, id)
	}
}

func (a *AppService) releaseWorkspaceImages(workspace string) {
	a.imageMu.Lock()
	defer a.imageMu.Unlock()
	for id, image := range a.imagePreviews {
		if image.workspace == workspace {
			a.releaseImageLocked(id)
		}
	}
}

func (a *AppService) imageAssetHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if !strings.HasPrefix(request.URL.Path, imagePreviewRoute) {
			next.ServeHTTP(writer, request)
			return
		}
		if request.URL.Path != imagePreviewRoute {
			http.NotFound(writer, request)
			return
		}
		if request.Method != http.MethodGet && request.Method != http.MethodHead {
			writer.Header().Set("Allow", "GET, HEAD")
			writer.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		a.imageMu.Lock()
		image := a.imagePreviews[request.Header.Get("X-TermQuay-Image")]
		if image != nil && image.expiry != nil {
			image.expiry.Stop()
			image.expiry = nil
		}
		a.imageMu.Unlock()
		if image == nil {
			http.NotFound(writer, request)
			return
		}
		writer.Header().Set("Content-Type", image.mime)
		writer.Header().Set("Content-Length", strconv.Itoa(len(image.data)))
		writer.Header().Set("Cache-Control", "no-store")
		writer.Header().Set("Vary", "X-TermQuay-Image")
		writer.Header().Set("X-Content-Type-Options", "nosniff")
		writer.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
		writer.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
		http.ServeContent(writer, request, "image", time.Time{}, bytes.NewReader(image.data))
	})
}
