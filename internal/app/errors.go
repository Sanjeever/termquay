package app

import (
	"encoding/json"
	"errors"

	"github.com/Sanjeever/termquay/internal/files"
)

func marshalServiceError(err error) []byte {
	var readError *files.ReadError
	if errors.As(err, &readError) {
		value, _ := json.Marshal(readError)
		return value
	}
	return nil
}
