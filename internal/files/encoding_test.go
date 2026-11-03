package files

import (
	"bytes"
	"strings"
	"testing"
)

func TestTextEncodingRoundTrip(t *testing.T) {
	for _, charset := range []string{"UTF-8", "GBK", "GB2312", "GB18030"} {
		for _, eol := range []string{"LF", "CRLF"} {
			document := Document{Content: "中文配置\nvalue=测试\n", Encoding: charset, LineEnding: eol, BOM: charset == "UTF-8"}
			data, err := EncodeDocument(document)
			if err != nil {
				t.Fatal(err)
			}
			content, name, bom, err := DecodeText(data, charset)
			if err != nil || name != charset || bom != document.BOM || LineEnding(content) != eol {
				t.Fatalf("编码或格式未保留: %s %s %v", charset, eol, err)
			}
			if strings.ReplaceAll(content, "\r\n", "\n") != document.Content {
				t.Fatal("文本往返不一致")
			}
			again, err := EncodeDocument(Document{Content: content, Encoding: name, BOM: bom, LineEnding: eol})
			if err != nil || !bytes.Equal(again, data) {
				t.Fatal("编码字节往返不一致")
			}
		}
	}
}

func TestTextEncodingRejectsInvalidOrUnrepresentableData(t *testing.T) {
	if _, _, _, err := DecodeText([]byte{0xff}, "GBK"); err == nil {
		t.Fatal("无效字节被静默替换")
	}
	if _, err := EncodeDocument(Document{Content: "emoji🔐", Encoding: "GBK"}); err == nil {
		t.Fatal("不可表示字符被静默替换")
	}
	if _, err := EncodeDocument(Document{Content: "emoji🔐", Encoding: "GB18030"}); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := DecodeText([]byte("test"), "invalid"); err == nil {
		t.Fatal("接受未知编码")
	}
	if LineEnding("one\r\ntwo\n") != "mixed" {
		t.Fatal("未识别混合换行符")
	}
}
