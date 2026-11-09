package app

import (
	"encoding/json"
	"errors"

	"github.com/Sanjeever/termquay/internal/files"
	"github.com/Sanjeever/termquay/internal/message"
)

func marshalServiceError(err error) []byte {
	detail := message.Describe(err)
	value := map[string]any{"message": detail.Message}
	structured := detail.MessageCode != "" || len(detail.Causes) > 0
	if structured {
		value["messageCode"], value["parameters"] = detail.MessageCode, detail.Parameters
		if len(detail.Causes) > 0 {
			value["causes"] = detail.Causes
		}
	}
	var connection *SSHConnectionFailure
	if errors.As(err, &connection) {
		value["steps"] = connection.Steps
		structured = true
	}
	var readError *files.ReadError
	if errors.As(err, &readError) {
		value["code"] = readError.Code
		value["messageCode"] = "backend:" + readError.Code
		structured = true
	}
	if !structured {
		return nil
	}
	encoded, _ := json.Marshal(value)
	return encoded
}
