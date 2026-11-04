package app

import (
	"strings"
	"testing"
)

func TestTerminalRecordingBounds(t *testing.T) {
	header := `{"version":2,"width":80,"height":24}` + "\n"
	for name, recording := range map[string]string{
		"空文件":    "",
		"旧版本":    `{"version":1,"width":80,"height":24}`,
		"无效尺寸":   `{"version":2,"width":0,"height":24}`,
		"尺寸过大":   `{"version":2,"width":1001,"height":24}`,
		"负时间":    header + `[-1,"o","text"]`,
		"时间倒退":   header + "[1,\"o\",\"text\"]\n[0,\"o\",\"text\"]",
		"事件缺字段":  header + `[0,"o"]`,
		"事件类型错误": header + `[0,1,"text"]`,
		"事件正文错误": header + `[0,"o",{}]`,
		"截断事件":   header + `[0,"o",`,
		"尺寸事件无效": header + `[0,"r","80"]`,
		"尺寸事件过大": header + `[0,"r","1001x24"]`,
		"事件过多":   header + strings.Repeat("[0,\"o\",\"\"]\n", 100001),
	} {
		t.Run(name, func(t *testing.T) {
			if err := validateRecordingBounds([]byte(recording)); err == nil {
				t.Fatal("接受了无效录制")
			}
		})
	}
	for _, recording := range []string{header, header + "[0,\"o\",\"中文\\n\"]\n[0,\"r\",\"1000x1\"]", header + strings.Repeat("[0,\"o\",\"\"]\n", 100000)} {
		if err := validateRecordingBounds([]byte(recording)); err != nil {
			t.Fatal("合法录制被拒绝", err)
		}
	}
}
