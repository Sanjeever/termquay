package app

import (
	"encoding/json"
	"errors"

	"github.com/Sanjeever/termquay/internal/files"
)

func marshalServiceError(err error) []byte {
	var connection *SSHConnectionFailure
	if errors.As(err, &connection) {
		value, _ := json.Marshal(connection)
		return value
	}
	var readError *files.ReadError
	if errors.As(err, &readError) {
		value, _ := json.Marshal(readError)
		return value
	}
	return nil
}
