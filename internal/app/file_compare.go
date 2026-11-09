package app

import (
	"errors"
	"io"
	"os"

	"github.com/Sanjeever/termquay/internal/files"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func (a *AppService) ChooseComparisonFile(charset string) (*files.Document, error) {
	filename, err := application.Get().Dialog.OpenFile().SetMessage(nativeText("Select comparison file", "选择对比文件")).PromptForSingleSelection()
	if err != nil || filename == "" {
		return nil, err
	}
	info, err := os.Lstat(filename)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > files.MaxEditSize {
		return nil, errors.New("对比支持不超过 2 MiB 的普通文本文件")
	}
	f, err := os.Open(filename)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, files.MaxEditSize+1))
	if err != nil {
		return nil, err
	}
	if len(data) > files.MaxEditSize {
		return nil, errors.New("文件超过对比大小限制")
	}
	content, encoding, bom, err := files.DecodeText(data, charset)
	if err != nil {
		return nil, err
	}
	return &files.Document{Path: filename, Content: content, Encoding: encoding, BOM: bom, LineEnding: files.LineEnding(content)}, nil
}
