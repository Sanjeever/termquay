package app

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCreateRemoteFileDoesNotOverwrite(t *testing.T) {
	a, _, directory := uploadTestClient(t)
	name := filepath.Join(directory, "new.txt")
	if err := a.CreateRemoteFile(t.Context(), "workspace", name); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(name, []byte("preserve"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := a.CreateRemoteFile(t.Context(), "workspace", name); err == nil {
		t.Fatal("existing file was accepted")
	}
	data, err := os.ReadFile(name)
	if err != nil || string(data) != "preserve" {
		t.Fatal("existing content changed", err)
	}
	a.workspaces["workspace"].browseOnly = true
	if err := a.CreateRemoteFile(t.Context(), "workspace", filepath.Join(directory, "blocked")); err == nil {
		t.Fatal("browse-only workspace accepted a write")
	}
}
