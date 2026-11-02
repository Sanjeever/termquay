package main

import (
	"strings"
	"testing"
)

func TestSnippetsEncryptedAndBounded(t *testing.T) {
	a := testAppStore(t)
	value, err := a.SaveSnippet(Snippet{Name: "片段", Group: "测试", Body: "echo snippet-test-placeholder"})
	if err != nil || value.ID == "" {
		t.Fatal(err)
	}
	stored, err := a.store.Setting("snippets")
	if err != nil || strings.Contains(stored, "snippet-test-placeholder") {
		t.Fatal("片段正文未加密")
	}
	value.Body = "echo changed-test-placeholder"
	if _, err = a.SaveSnippet(value); err != nil {
		t.Fatal(err)
	}
	list, err := a.ListSnippets()
	if err != nil || len(list) != 1 || list[0].Body != value.Body {
		t.Fatal("片段修改未保存")
	}
	if _, err = a.SaveSnippet(Snippet{Name: "too large", Body: strings.Repeat("x", (32<<10)+1)}); err == nil {
		t.Fatal("接受过大片段")
	}
	if err = a.DeleteSnippet(value.ID); err != nil {
		t.Fatal(err)
	}
	list, err = a.ListSnippets()
	if err != nil || len(list) != 0 {
		t.Fatal("片段未删除")
	}
}
