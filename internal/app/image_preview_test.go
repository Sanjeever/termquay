package app

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/gif"
	"image/png"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestImagePreviewResourceLifetime(t *testing.T) {
	a := NewAppService(BuildInfo{Development: true}, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	owner := &workspaceOwner{ctx: ctx}
	a.workspaces["preview"] = owner
	defer a.releaseWorkspaceImages("preview")
	frame := image.NewPaletted(image.Rect(1, 1, 2, 2), color.Palette{color.Transparent, color.RGBA{R: 255, A: 255}})
	frame.SetColorIndex(1, 1, 1)
	var source bytes.Buffer
	if err := gif.EncodeAll(&source, &gif.GIF{Image: []*image.Paletted{frame}, Delay: []int{0}, Config: image.Config{Width: 4, Height: 4, ColorModel: frame.Palette}}); err != nil {
		t.Fatal(err)
	}
	preview, err := a.publishImage(ctx, "preview", owner, source.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	handler := a.imageAssetHandler(http.NotFoundHandler())
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, preview.URL, nil)
	request.Header.Set("X-TermQuay-Image", preview.ID)
	handler.ServeHTTP(response, request)
	decoded, err := png.Decode(bytes.NewReader(response.Body.Bytes()))
	if err != nil || decoded.Bounds() != image.Rect(0, 0, 4, 4) || response.Header().Get("Content-Type") != "image/png" {
		t.Fatal("GIF 首帧未保留完整画布", err)
	}
	red, _, _, _ := decoded.At(1, 1).RGBA()
	if red == 0 {
		t.Fatal("GIF 首帧偏移位置错误")
	}
	if _, err := a.publishImage(ctx, "preview", owner, []byte("<svg><script>test</script></svg>")); err == nil {
		t.Fatal("将可执行文档作为图片返回")
	}
	invalid := httptest.NewRecorder()
	handler.ServeHTTP(invalid, httptest.NewRequest(http.MethodGet, preview.URL, nil))
	if invalid.Code != http.StatusNotFound {
		t.Fatal("未知资源地址可读取数据")
	}
	a.ReleaseImagePreview(preview.ID)
	if len(a.imagePreviews) != 0 || a.imageBytes != 0 || a.imagePixels != 0 {
		t.Fatal("释放后仍保留图片资源")
	}
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusNotFound {
		t.Fatal("释放后仍可读取图片")
	}
}
