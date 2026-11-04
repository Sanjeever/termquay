package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"github.com/Sanjeever/termquay/internal/files"
)

func TestFileReadErrorsCarryRecoveryCode(t *testing.T) {
	for _, test := range []struct {
		code string
		data []byte
	}{
		{"file_encoding", []byte{0xff}},
		{"file_binary", []byte{0}},
		{"file_too_large", bytes.Repeat([]byte("a"), files.MaxEditSize+1)},
	} {
		_, _, _, err := files.DecodeText(test.data, "UTF-8")
		if err == nil {
			t.Fatalf("%s 未返回读取错误", test.code)
		}
		var detail struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		if err := json.Unmarshal(marshalServiceError(fmt.Errorf("读取失败: %w", err)), &detail); err != nil {
			t.Fatal(err)
		}
		if detail.Code != test.code || detail.Message == "" {
			t.Fatalf("恢复代码未传递到界面: %+v", detail)
		}
	}
	if marshalServiceError(errors.New("普通操作失败")) != nil {
		t.Fatal("普通错误未沿用框架处理")
	}
}
