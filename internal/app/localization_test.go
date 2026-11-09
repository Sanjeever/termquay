package app

import "testing"

func TestPortableLanguage(t *testing.T) {
	legacy := `"theme":"system","uiFont":"system","monoFont":"system","terminalPalette":"theme"`
	for _, suffix := range []string{"", `,"language":"auto"`, `,"language":"en"`, `,"language":"zh-CN"`} {
		if err := validatePortableUI(map[string]string{"appearance": "{" + legacy + suffix + "}"}); err != nil {
			t.Fatal(err)
		}
	}
	for _, value := range []string{`"zh-TW"`, `null`, `42`, `""`} {
		if err := validatePortableUI(map[string]string{"appearance": "{" + legacy + `,"language":` + value + "}"}); err == nil {
			t.Fatalf("accepted invalid language %s", value)
		}
	}
}
