package app

import "testing"

func TestPortableCustomFont(t *testing.T) {
	base := `"theme":"system","uiFont":"system","monoFont":"custom","terminalPalette":"theme"`
	for _, suffix := range []string{"", `,"customMonoFont":""`, `,"customMonoFont":"JetBrainsMono Nerd Font Mono"`} {
		if err := validatePortableUI(map[string]string{"appearance": "{" + base + suffix + "}"}); err != nil {
			t.Fatal(err)
		}
	}
	for _, value := range []string{`null`, `42`, `[]`, `{}`} {
		if err := validatePortableUI(map[string]string{"appearance": "{" + base + `,"customMonoFont":` + value + "}"}); err == nil {
			t.Fatalf("accepted invalid custom font %s", value)
		}
	}
}
