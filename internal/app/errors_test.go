package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"github.com/Sanjeever/termquay/internal/files"
	"github.com/Sanjeever/termquay/internal/message"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
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

func TestLocalizedFailurePreservesSSHContext(t *testing.T) {
	cause := message.New("backend:hostIdentityRequired", "original diagnostic")
	err := &SSHConnectionFailure{Message: cause.Error(), Steps: []terminal.ConnectionStep{{Host: "example.invalid", State: "failed", Code: "identity"}}, err: cause}
	var detail struct {
		Message     string                    `json:"message"`
		MessageCode string                    `json:"messageCode"`
		Steps       []terminal.ConnectionStep `json:"steps"`
	}
	if decodeErr := json.Unmarshal(marshalServiceError(err), &detail); decodeErr != nil {
		t.Fatal(decodeErr)
	}
	if detail.Message != "original diagnostic" || detail.MessageCode != "backend:hostIdentityRequired" || len(detail.Steps) != 1 || detail.Steps[0].Code != "identity" || !errors.Is(err, cause) {
		t.Fatalf("lost localized failure context: %+v", detail)
	}
}

func TestCommandStateCodesPreserveLegacyMachineValues(t *testing.T) {
	record := commandRecordWithStateCodes(CommandRunRecord{Summary: CommandRunSummary{State: "等待确认"}})
	data, err := json.Marshal(record.Summary)
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(data, &value); err != nil {
		t.Fatal(err)
	}
	if value["state"] != "等待确认" || value["state_code"] != "awaiting_confirmation" {
		t.Fatalf("state contract changed: %s", data)
	}
}
