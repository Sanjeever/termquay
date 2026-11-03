package main

import (
	"context"
	"errors"
	"io"
	"path"
	"time"
	"unicode/utf8"
)

type RemoteLogSlice struct {
	Content string `json:"content"`
	Start   int64  `json:"start"`
	End     int64  `json:"end"`
	Size    int64  `json:"size"`
	Reset   bool   `json:"reset"`
}

func (a *AppService) ReadRemoteLog(ctx context.Context, workspace, remote string, offset int64, backward bool) (RemoteLogSlice, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if !path.IsAbs(remote) || len(remote) > 4096 || offset < -1 {
		return RemoteLogSlice{}, errors.New("日志路径或偏移无效")
	}
	client, release, err := a.fileClient(ctx, workspace)
	if err != nil {
		return RemoteLogSlice{}, err
	}
	defer release()
	info, err := client.Lstat(remote)
	if err != nil {
		return RemoteLogSlice{}, err
	}
	if !info.Mode().IsRegular() {
		return RemoteLogSlice{}, errors.New("日志查看支持普通文件，符号链接须使用实际目标路径")
	}
	file, err := client.Open(remote)
	if err != nil {
		return RemoteLogSlice{}, err
	}
	defer file.Close()
	result := RemoteLogSlice{Size: info.Size()}
	if offset == -1 {
		result.End = info.Size()
		result.Start = max(0, result.End-(128<<10))
	} else if backward {
		result.End = min(offset, info.Size())
		result.Start = max(0, result.End-(128<<10))
	} else {
		result.Start = offset
		if offset > info.Size() {
			result.Start = 0
			result.Reset = true
		}
		result.End = min(info.Size(), result.Start+(128<<10))
	}
	data := make([]byte, result.End-result.Start)
	n, err := file.ReadAt(data, result.Start)
	if err != nil && !errors.Is(err, io.EOF) {
		return RemoteLogSlice{}, err
	}
	data = data[:n]
	result.End = result.Start + int64(n)
	if result.Start > 0 {
		for skipped := 0; len(data) > 0 && !utf8.RuneStart(data[0]) && skipped < 3; skipped++ {
			data = data[1:]
			result.Start++
		}
	}
	if len(data) > 0 {
		last := len(data) - 1
		for last > 0 && !utf8.RuneStart(data[last]) {
			last--
		}
		if !utf8.FullRune(data[last:]) {
			result.End -= int64(len(data) - last)
			data = data[:last]
		}
	}
	if !utf8.Valid(data) {
		return RemoteLogSlice{}, errors.New("日志片段包含无效 UTF-8，请下载后以原始编码查看")
	}
	result.Content = string(data)
	return result, nil
}
