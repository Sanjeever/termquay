package files

import (
	"bytes"

	"fmt"
	"strings"
	"unicode/utf8"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/simplifiedchinese"
)

type ReadError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *ReadError) Error() string          { return e.Message }
func (e *ReadError) DiagnosticCode() string { return "backend:" + e.Code }

func textEncoding(name string) (string, encoding.Encoding, error) {
	switch strings.ToUpper(name) {
	case "", "UTF-8":
		return "UTF-8", nil, nil
	case "ANSI", "GBK":
		return "GBK", simplifiedchinese.GBK, nil
	case "GB2312":
		return "GB2312", simplifiedchinese.GBK, nil
	case "GB18030":
		return "GB18030", simplifiedchinese.GB18030, nil
	default:
		return "", nil, &ReadError{Code: "file_encoding", Message: "不支持的文件编码"}
	}
}

func DecodeText(data []byte, charset string) (content, name string, bom bool, err error) {
	return decodeText(data, charset, true)
}

func decodeText(data []byte, charset string, initial bool) (content, name string, bom bool, err error) {
	if bytes.IndexByte(data, 0) >= 0 {
		return "", "", false, &ReadError{Code: "file_binary", Message: "文件包含二进制内容，请下载后打开"}
	}
	name, codec, err := textEncoding(charset)
	if err != nil {
		return "", "", false, err
	}
	if codec == nil {
		bom = initial && bytes.HasPrefix(data, []byte{0xef, 0xbb, 0xbf})
		if bom {
			data = data[3:]
		}
		if !utf8.Valid(data) {
			return "", "", false, &ReadError{Code: "file_encoding", Message: "无法以 UTF-8 打开此文件，请选择其他编码"}
		}
		content = string(data)
	} else {
		decoded, decodeErr := codec.NewDecoder().Bytes(data)
		if decodeErr != nil {
			return "", "", false, &ReadError{Code: "file_encoding", Message: fmt.Sprintf("无法用 %s 解码文件: %v", name, decodeErr)}
		}
		roundTrip, encodeErr := codec.NewEncoder().Bytes(decoded)
		if encodeErr != nil || !bytes.Equal(roundTrip, data) {
			return "", "", false, &ReadError{Code: "file_encoding", Message: fmt.Sprintf("文件含无效的 %s 字节，请选择正确编码", name)}
		}
		content = string(decoded)
	}
	if len(content) > MaxEditSize {
		return "", "", false, &ReadError{Code: "file_too_large", Message: "解码后的文件超过 2 MiB，请下载后编辑"}
	}
	return content, name, bom, nil
}

func LineEnding(content string) string {
	remaining := strings.ReplaceAll(content, "\r\n", "")
	if strings.ContainsRune(remaining, '\r') || strings.Contains(content, "\r\n") && strings.ContainsRune(remaining, '\n') {
		return "mixed"
	}
	if strings.Contains(content, "\r\n") {
		return "CRLF"
	}
	return "LF"
}

func EncodeDocument(document Document) ([]byte, error) {
	if !utf8.ValidString(document.Content) || strings.IndexByte(document.Content, 0) >= 0 || len(document.Content) > MaxEditSize {
		return nil, appmessage.New("backend:contentIsInvalidTextOrExceeds2MiB", "内容不是有效文本或超过 2 MiB")
	}
	content := document.Content
	switch document.LineEnding {
	case "", "mixed":
	case "LF", "CRLF":
		content = strings.ReplaceAll(strings.ReplaceAll(content, "\r\n", "\n"), "\r", "\n")
		if document.LineEnding == "CRLF" {
			content = strings.ReplaceAll(content, "\n", "\r\n")
		}
	default:
		return nil, appmessage.New("backend:invalidLineEndings", "换行符无效")
	}
	name, codec, err := textEncoding(document.Encoding)
	if err != nil {
		return nil, err
	}
	data := []byte(content)
	if codec != nil {
		data, err = codec.NewEncoder().Bytes(data)
		if err != nil {
			return nil, appmessage.Errorf("backend:cannotRepresentTheCurrentContentUseUTF8", "%s 无法表示当前内容，请改用 UTF-8 或 GB18030: %w", name, err)
		}
	} else if document.BOM {
		data = append([]byte{0xef, 0xbb, 0xbf}, data...)
	}
	if len(data) > MaxEditSize {
		return nil, appmessage.New("backend:encodedFileExceeds2MiB", "编码后的文件超过 2 MiB")
	}
	return data, nil
}
