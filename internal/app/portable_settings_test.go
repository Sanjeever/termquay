package app

import "testing"

func TestPortableLocalEditor(t *testing.T) {
	base := `"theme":"system","uiFont":"system","monoFont":"system","terminalPalette":"theme"`
	for _, value := range []string{`"vscode"`, `"vscode-insiders"`} {
		if err := validatePortableUI(map[string]string{"appearance": "{" + base + `,"localEditor":` + value + "}"}); err != nil {
			t.Fatal(err)
		}
	}
	for _, value := range []string{`null`, `42`, `"https"`, `""`} {
		if err := validatePortableUI(map[string]string{"appearance": "{" + base + `,"localEditor":` + value + "}"}); err == nil {
			t.Fatalf("accepted editor %s", value)
		}
	}
}

func TestPortableTerminalShortcuts(t *testing.T) {
	valid := `{"nextWorkspace":"Ctrl+Tab","previousWorkspace":"Ctrl+Shift+Tab","newLocalTerminal":"Ctrl+Shift+KeyT","workspaceSearch":"Ctrl+Shift+KeyO","copy":"Ctrl+Shift+KeyC","paste":"Ctrl+Shift+KeyV","closeTab":"Ctrl+Shift+KeyW"}`
	if err := validatePortableUI(map[string]string{"shortcuts": valid}); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{
		`{"palette":"Mod+KeyC"}`,
		`{"palette":"Mod+Shift+KeyW"}`,
		`{"palette":"Ctrl+Tab","nextWorkspace":"Ctrl+Tab"}`,
		`{"copy":"Ctrl+Shift+KeyC","paste":"Ctrl+Shift+KeyC"}`,
	} {
		if err := validatePortableUI(map[string]string{"shortcuts": invalid}); err == nil {
			t.Fatalf("accepted invalid shortcuts %s", invalid)
		}
	}
}

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

func TestPortableCopyOnSelect(t *testing.T) {
	base := `"theme":"system","uiFont":"system","monoFont":"system","terminalPalette":"theme"`
	for _, value := range []string{"true", "false"} {
		if err := validatePortableUI(map[string]string{"appearance": "{" + base + `,"terminalCopyOnSelect":` + value + "}"}); err != nil {
			t.Fatal(err)
		}
	}
	for _, value := range []string{`null`, `"true"`, `1`} {
		if err := validatePortableUI(map[string]string{"appearance": "{" + base + `,"terminalCopyOnSelect":` + value + "}"}); err == nil {
			t.Fatalf("accepted invalid copy-on-select preference %s", value)
		}
	}
}

func TestPortableLocalTerminalRenderer(t *testing.T) {
	base := `"theme":"system","uiFont":"system","monoFont":"system","terminalPalette":"theme"`
	for _, value := range []string{`"dom"`, `"webgl"`} {
		if err := validatePortableUI(map[string]string{"appearance": "{" + base + `,"localTerminalRenderer":` + value + "}"}); err != nil {
			t.Fatal(err)
		}
	}
	for _, value := range []string{`null`, `true`, `"canvas"`} {
		if err := validatePortableUI(map[string]string{"appearance": "{" + base + `,"localTerminalRenderer":` + value + "}"}); err == nil {
			t.Fatalf("accepted invalid local terminal renderer %s", value)
		}
	}
}
