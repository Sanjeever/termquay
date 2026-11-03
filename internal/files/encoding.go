package files

import (
	"bytes"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/simplifiedchinese"
)

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
		return "", nil, errors.New("不支持的文件编码")
	}
}

func DecodeText(data []byte, charset string) (content, name string, bom bool, err error) {
	name, codec, err := textEncoding(charset)
	if err != nil {
		return "", "", false, err
	}
	if codec == nil {
		bom = bytes.HasPrefix(data, []byte{0xef, 0xbb, 0xbf})
		if bom {
			data = data[3:]
		}
		if !utf8.Valid(data) {
			return "", "", false, errors.New("文件不是 UTF-8 文本，请选择编码重新打开")
		}
		content = string(data)
	} else {
		decoded, decodeErr := codec.NewDecoder().Bytes(data)
		if decodeErr != nil {
			return "", "", false, fmt.Errorf("无法用 %s 解码文件: %w", name, decodeErr)
		}
		roundTrip, encodeErr := codec.NewEncoder().Bytes(decoded)
		if encodeErr != nil || !bytes.Equal(roundTrip, data) {
			return "", "", false, fmt.Errorf("文件含无效的 %s 字节，请选择正确编码", name)
		}
		content = string(decoded)
	}
	if strings.IndexByte(content, 0) >= 0 || len(content) > MaxEditSize {
		return "", "", false, errors.New("文件包含二进制内容或解码后超过 2 MiB")
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
		return nil, errors.New("内容不是有效文本或超过 2 MiB")
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
		return nil, errors.New("换行符无效")
	}
	name, codec, err := textEncoding(document.Encoding)
	if err != nil {
		return nil, err
	}
	data := []byte(content)
	if codec != nil {
		data, err = codec.NewEncoder().Bytes(data)
		if err != nil {
			return nil, fmt.Errorf("%s 无法表示当前内容，请改用 UTF-8 或 GB18030: %w", name, err)
		}
	} else if document.BOM {
		data = append([]byte{0xef, 0xbb, 0xbf}, data...)
	}
	if len(data) > MaxEditSize {
		return nil, errors.New("编码后的文件超过 2 MiB")
	}
	return data, nil
}
