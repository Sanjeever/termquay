package app

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFilePasteDirectoryAndSameDirectoryCopy(t *testing.T) {
	a, _, root := uploadTestClient(t)
	source := filepath.Join(root, "source")
	if err := os.MkdirAll(filepath.Join(source, "empty"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "file.txt"), []byte("copied bytes"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("file.txt", filepath.Join(source, "link")); err != nil {
		t.Fatal(err)
	}
	clipboard := &remoteFileClipboard{workspace: "workspace", paths: []string{source}}
	preview, err := a.previewFilePaste(t.Context(), clipboard, "workspace", root, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(preview.PasteItems) != 1 || preview.PasteItems[0].Name != "source copy" || preview.PasteItems[0].Exists {
		t.Fatalf("invalid duplicate name: %+v", preview.PasteItems)
	}
	conflicts := 0
	for _, entry := range preview.Entries {
		if entry.State == "conflict" {
			conflicts++
		}
	}
	if conflicts != 1 {
		t.Fatalf("symbolic link was not reported: %+v", preview.Entries)
	}
	view, err := a.ExecuteFilePaste(preview.ID, []FilePasteChoice{{Name: "source copy", Action: "copy"}})
	if err != nil {
		t.Fatal(err)
	}
	sg1WorkflowWaitTransfer(t, a, view.ID, "done")
	data, err := os.ReadFile(filepath.Join(root, "source copy", "file.txt"))
	if err != nil || string(data) != "copied bytes" {
		t.Fatal("contents were not copied", err)
	}
	if info, err := os.Stat(filepath.Join(root, "source copy", "empty")); err != nil || !info.IsDir() {
		t.Fatal("empty directory was not copied", err)
	}
	if _, err := os.Lstat(filepath.Join(root, "source copy", "link")); !os.IsNotExist(err) {
		t.Fatal("unsupported link was copied", err)
	}
	preview, err = a.previewFilePaste(t.Context(), clipboard, "workspace", root, nil)
	if err != nil || preview.PasteItems[0].Name != "source copy 2" {
		t.Fatal("duplicate name was reused", err)
	}
	a.CancelDirectorySyncPreview(preview.ID)
}

func TestFilePasteConflictAndChangedDestination(t *testing.T) {
	a, _, root := uploadTestClient(t)
	source, target := filepath.Join(root, "source.txt"), filepath.Join(root, "target")
	if err := os.Mkdir(target, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source, []byte("new"), 0600); err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(target, "source.txt")
	if err := os.WriteFile(destination, []byte("old contents"), 0600); err != nil {
		t.Fatal(err)
	}
	clipboard := &remoteFileClipboard{workspace: "workspace", paths: []string{source}}
	preview, err := a.previewFilePaste(t.Context(), clipboard, "workspace", target, nil)
	if err != nil || !preview.PasteItems[0].Exists {
		t.Fatal("missing conflict", err)
	}
	if _, err := a.ExecuteFilePaste(preview.ID, []FilePasteChoice{{Name: "source.txt", Action: "copy"}}); err == nil {
		t.Fatal("overwrite did not require explicit approval")
	}
	view, err := a.ExecuteFilePaste(preview.ID, []FilePasteChoice{{Name: "source.txt", Action: "overwrite"}})
	if err != nil {
		t.Fatal(err)
	}
	sg1WorkflowWaitTransfer(t, a, view.ID, "done")
	data, err := os.ReadFile(destination)
	if err != nil || string(data) != "new" {
		t.Fatal("explicit overwrite failed", err)
	}
	preview, err = a.previewFilePaste(t.Context(), clipboard, "workspace", target, []string{"renamed.txt"})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(target, "renamed.txt"), []byte("concurrent"), 0600); err != nil {
		t.Fatal(err)
	}
	view, err = a.ExecuteFilePaste(preview.ID, []FilePasteChoice{{Name: "renamed.txt", Action: "copy"}})
	if err != nil {
		t.Fatal(err)
	}
	sg1WorkflowWaitTransfer(t, a, view.ID, "failed")
	data, err = os.ReadFile(filepath.Join(target, "renamed.txt"))
	if err != nil || string(data) != "concurrent" {
		t.Fatal("concurrent destination was overwritten", err)
	}
}

func TestFilePasteRejectsDescendantAndReadOnly(t *testing.T) {
	a, _, root := uploadTestClient(t)
	source := filepath.Join(root, "source")
	child := filepath.Join(source, "child")
	if err := os.MkdirAll(child, 0700); err != nil {
		t.Fatal(err)
	}
	clipboard := &remoteFileClipboard{workspace: "workspace", paths: []string{source}}
	if _, err := a.previewFilePaste(t.Context(), clipboard, "workspace", child, nil); err == nil {
		t.Fatal("descendant destination accepted")
	}
	a.workspaces["workspace"].browseOnly = true
	if _, err := a.previewFilePaste(t.Context(), clipboard, "workspace", root, nil); err == nil {
		t.Fatal("read-only destination accepted")
	}
}
