package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"unicode/utf8"

	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func (a *AppService) StartTerminalRecording(id string) (terminal.TerminalLogStatus, error) {
	t, err := a.terminalInstance(id)
	if err != nil {
		return terminal.TerminalLogStatus{}, err
	}
	status := t.LogStatus()
	parent := filepath.Dir(status.Directory)
	if status.Directory == "" || status.Format != "asciicast" || status.Finished {
		parent, err = application.Get().Dialog.OpenFile().SetTitle(nativeText("Select terminal recording location", "选择终端录制的保存位置")).CanChooseFiles(false).CanChooseDirectories(true).PromptForSingleSelection()
		if err != nil || parent == "" {
			return terminal.TerminalLogStatus{}, err
		}
	}
	select {
	case <-t.Done:
		return terminal.TerminalLogStatus{}, errors.New("终端已断开")
	default:
	}
	return t.StartTimedLog(parent)
}

type TerminalRecording struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

func (a *AppService) ChooseTerminalRecording() (TerminalRecording, error) {
	filename, err := application.Get().Dialog.OpenFile().SetTitle(nativeText("Open terminal recording", "打开终端录制")).AddFilter(nativeText("Terminal recordings (*.cast)", "终端录制 (*.cast)"), "*.cast").PromptForSingleSelection()
	if err != nil || filename == "" {
		return TerminalRecording{}, err
	}
	return readTerminalRecording(filename)
}

func (a *AppService) ReadTerminalRecording(id string) (TerminalRecording, error) {
	t, err := a.terminalInstance(id)
	if err != nil {
		return TerminalRecording{}, err
	}
	status := t.LogStatus()
	if status.Format != "asciicast" || status.File == "" {
		return TerminalRecording{}, errors.New("本次终端尚未生成可回放录制；ANSI 输出日志不能按时间回放")
	}
	if status.Recording {
		return TerminalRecording{}, errors.New("请先暂停或结束录制，再打开回放")
	}
	return readTerminalRecording(status.File)
}

func readTerminalRecording(filename string) (TerminalRecording, error) {
	if strings.EqualFold(filepath.Ext(filename), ".ansi") {
		return TerminalRecording{}, errors.New("该文件是 ANSI 输出日志，不能按时间回放，请选择 .cast 录制")
	}
	file, err := os.Open(filename)
	if err != nil {
		return TerminalRecording{}, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return TerminalRecording{}, err
	}
	if !info.Mode().IsRegular() || info.Size() > 16<<20 {
		return TerminalRecording{}, errors.New("录制须为不超过 16 MiB 的普通文件")
	}
	data, err := io.ReadAll(io.LimitReader(file, (16<<20)+1))
	if err != nil {
		return TerminalRecording{}, err
	}
	if len(data) > 16<<20 || !utf8.Valid(data) {
		return TerminalRecording{}, errors.New("录制超过大小限制或不是 UTF-8")
	}
	if err := validateRecordingBounds(data); err != nil {
		return TerminalRecording{}, err
	}
	return TerminalRecording{Name: filepath.Base(filename), Content: string(data)}, nil
}

func validateRecordingBounds(data []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	var header struct {
		Version int `json:"version"`
		Width   int `json:"width"`
		Height  int `json:"height"`
	}
	if err := decoder.Decode(&header); err != nil {
		return err
	}
	if header.Version != 2 || header.Width < 1 || header.Height < 1 || header.Width > 1000 || header.Height > 1000 {
		return errors.New("录制须为 asciicast v2，尺寸为 1 至 1000")
	}
	previous := 0.0
	for count := 0; ; count++ {
		var event []json.RawMessage
		err := decoder.Decode(&event)
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		if count >= 100000 || len(event) != 3 {
			return errors.New("录制事件无效或超过 100000 项")
		}
		var timestamp float64
		var kind, content string
		if err = json.Unmarshal(event[0], &timestamp); err != nil {
			return err
		}
		if math.IsNaN(timestamp) || math.IsInf(timestamp, 0) || timestamp < previous {
			return errors.New("录制时间无效")
		}
		previous = timestamp
		if err = json.Unmarshal(event[1], &kind); err != nil {
			return err
		}
		if err = json.Unmarshal(event[2], &content); err != nil {
			return err
		}
		if kind == "r" {
			parts := strings.Split(content, "x")
			if len(parts) != 2 {
				return errors.New("录制尺寸事件无效")
			}
			width, e1 := strconv.Atoi(parts[0])
			height, e2 := strconv.Atoi(parts[1])
			if e1 != nil || e2 != nil || width < 1 || height < 1 || width > 1000 || height > 1000 {
				return errors.New("录制尺寸超过限制")
			}
		}
	}
}
