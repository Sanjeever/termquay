package app

import (
	"context"
	"fmt"
	"net"
	"os"
	"path"
	"strconv"
	"testing"
	"time"

	terminal "github.com/Sanjeever/termquay/internal/ssh"
)

func TestRealFileOperations(t *testing.T) {
	password := os.Getenv("TERMQUAY_TEST_FILES_PASSWORD")
	if password == "" {
		t.Skip("real file-operation credentials are not configured")
	}
	port, err := strconv.Atoi(os.Getenv("TERMQUAY_TEST_FILES_PORT"))
	if err != nil {
		t.Fatal("invalid test port")
	}
	request := terminal.Request{Host: os.Getenv("TERMQUAY_TEST_FILES_HOST"), Port: port, Username: os.Getenv("TERMQUAY_TEST_FILES_USERNAME"), Password: password, Fingerprint: os.Getenv("TERMQUAY_TEST_HOST_FINGERPRINT"), Cols: 80, Rows: 24}
	if request.Host == "" || request.Username == "" || request.Fingerprint == "" {
		t.Fatal("missing test target or verified fingerprint")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Minute)
	defer cancel()
	connection, err := terminal.Dial(ctx, request)
	if err != nil {
		t.Fatal("real SSH authentication or identity verification failed")
	}
	a := testAppStore(t)
	a.transferEvent = func(Transfer) {}
	a.workspaces["real-files"] = &workspaceOwner{terminal: connection, ctx: ctx, cancel: cancel, timer: time.NewTimer(time.Hour), target: request.Username + "@" + net.JoinHostPort(request.Host, strconv.Itoa(port)), identity: request.Fingerprint}
	defer a.CloseWorkspace("real-files")
	root := fmt.Sprintf("/tmp/termquay-files-%d", time.Now().UnixNano())
	if err := a.CreateRemoteDirectory(ctx, "real-files", root); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, stop := context.WithTimeout(context.Background(), 30*time.Second)
		defer stop()
		if err := a.DeleteRemotePath(cleanup, "real-files", root); err != nil {
			t.Errorf("test directory cleanup failed: %v", err)
		}
	}()
	source := path.Join(root, "source")
	for _, name := range []string{source, source + "/empty", source + "/nested"} {
		if err := a.CreateRemoteDirectory(ctx, "real-files", name); err != nil {
			t.Fatal(err)
		}
	}
	file := source + "/nested/test.txt"
	if err := a.CreateRemoteFile(ctx, "real-files", file); err != nil {
		t.Fatal(err)
	}
	document, err := a.ReadRemoteFile(ctx, "real-files", file)
	if err != nil {
		t.Fatal(err)
	}
	document.Content = "real SFTP copy: 中文\n"
	if _, err := a.SaveRemoteFile(ctx, "real-files", document); err != nil {
		t.Fatal(err)
	}
	if err := a.CreateRemoteFile(ctx, "real-files", file); err == nil {
		t.Fatal("existing file accepted")
	}
	clipboard := &remoteFileClipboard{workspace: "real-files", paths: []string{source}}
	preview, err := a.previewFilePaste(ctx, clipboard, "real-files", root, nil)
	if err != nil {
		t.Fatal(err)
	}
	if preview.PasteItems[0].Name != "source copy" {
		t.Fatal("same-directory paste has no distinct name")
	}
	view, err := a.ExecuteFilePaste(preview.ID, []FilePasteChoice{{Name: "source copy", Action: "copy"}})
	if err != nil {
		t.Fatal(err)
	}
	sg1WorkflowWaitTransfer(t, a, view.ID, "done")
	copied, err := a.ReadRemoteFile(ctx, "real-files", root+"/source copy/nested/test.txt")
	if err != nil || copied.Content != document.Content {
		t.Fatal("copied bytes differ", err)
	}
	listing, err := a.ReadDirectory(ctx, "real-files", root+"/source copy/empty")
	if err != nil || len(listing.Entries) != 0 {
		t.Fatal("empty directory was not copied", err)
	}
	if err := a.DeleteRemotePath(ctx, "real-files", root+"/source copy/empty"); err != nil {
		t.Fatal("empty directory deletion failed", err)
	}
	if err := a.DeleteRemotePath(ctx, "real-files", root+"/source copy"); err != nil {
		t.Fatal("nonempty directory deletion failed", err)
	}
	client, release, err := a.fileClient(ctx, "real-files")
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	link := source + "/outside-link"
	if err := client.Symlink(root, link); err != nil {
		t.Fatal(err)
	}
	if err := a.DeleteRemotePath(ctx, "real-files", source); err != nil {
		t.Fatal("directory containing a link could not be deleted", err)
	}
	if _, err := client.Stat(root); err != nil {
		t.Fatal("deletion followed the symbolic link", err)
	}
	_, err = client.Lstat(root + "/source copy/nested/test.txt")
	if !os.IsNotExist(err) {
		t.Fatal("deleted copy remains", err)
	}
	t.Log("real file creation, exclusive names, editing, directory copy, empty/nonempty deletion and symlink isolation passed")
}
