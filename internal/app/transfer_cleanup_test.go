package app

import (
	"os"
	"path"
	"path/filepath"
	"testing"

	"github.com/Sanjeever/termquay/internal/files"
)

func TestDiscardUploadStagingAlreadyRemoved(t *testing.T) {
	for _, state := range []string{"missing", "empty", "data", "unexpected-entry"} {
		t.Run(state, func(t *testing.T) {
			a, client, remote := uploadTestClient(t)
			staging, err := files.CreateStaging(client, remote)
			if err != nil {
				t.Fatal(err)
			}
			if state == "missing" {
				if err := client.RemoveDirectory(staging); err != nil {
					t.Fatal(err)
				}
			}
			if state == "data" || state == "unexpected-entry" {
				name := "data"
				if state == "unexpected-entry" {
					name = "keep"
				}
				if err := os.WriteFile(path.Join(staging, name), []byte("partial"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			a.transfers["cleanup"] = &transferTask{
				view: Transfer{ID: "cleanup", State: "cancelled", Target: a.workspaces["workspace"].target},
				spec: &transferSpec{direction: "upload"}, cleanupStaging: staging,
			}
			err = a.DiscardTransferResume("cleanup", "workspace")
			if state == "unexpected-entry" {
				if err == nil || a.transfers["cleanup"] == nil || a.transfers["cleanup"].resumeClaimed {
					t.Fatal("Cleanup failure must retain an actionable record")
				}
				if err := client.Remove(path.Join(staging, "keep")); err != nil {
					t.Fatal(err)
				}
				err = a.DiscardTransferResume("cleanup", "workspace")
			}
			if err != nil || len(a.ListTransfers()) != 0 {
				t.Fatalf("Staging cleanup failed: %v", err)
			}
			if _, err := client.Lstat(staging); !os.IsNotExist(err) {
				t.Fatalf("Staging directory still exists: %v", err)
			}
		})
	}
}

func TestClearRetainedTransfersOfflinePersistsRemoval(t *testing.T) {
	for _, bulk := range []bool{false, true} {
		t.Run(map[bool]string{false: "single", true: "bulk"}[bulk], func(t *testing.T) {
			a := testAppStore(t)
			a.transferEvent = func(Transfer) {}
			local := filepath.Join(t.TempDir(), "source")
			if err := os.WriteFile(local, []byte("source"), 0600); err != nil {
				t.Fatal(err)
			}
			info, err := os.Stat(local)
			if err != nil {
				t.Fatal(err)
			}
			staging := "/remote/.termquay-00000000000000000000000000000000"
			for _, id := range []string{"resumable", "keep"} {
				a.transfers[id] = &transferTask{
					view:         Transfer{ID: id, State: "cancelled", Direction: "upload", Target: "test@example.invalid:22"},
					peerIdentity: "verified-test-identity",
					spec:         &transferSpec{direction: "upload", local: local, remote: "/remote/target"},
					resume:       &transferResume{source: info, offset: 1, staging: staging, temporary: path.Join(staging, "data")},
				}
			}
			if err := a.persistTransferResumes(); err != nil {
				t.Fatal(err)
			}
			a.transfers["cleanup"] = &transferTask{view: Transfer{State: "failed"}, cleanupStaging: staging}
			a.transfers["running"] = &transferTask{view: Transfer{State: "running"}}
			if bulk {
				removed, err := a.ClearFinishedTransfers()
				if err != nil || len(removed) != 3 || len(a.transfers) != 1 {
					t.Fatalf("Bulk removal failed: %v %v", removed, err)
				}
			} else {
				for _, id := range []string{"resumable", "cleanup"} {
					if _, err := a.ClearTransfer(id); err != nil {
						t.Fatal(err)
					}
				}
			}
			b := NewAppService(BuildInfo{Development: true}, nil)
			b.store = a.store
			if err := b.RestoreTransferResumes(); err != nil {
				t.Fatal(err)
			}
			if b.transfers["resumable"] != nil || bulk && len(b.transfers) != 0 || !bulk && b.transfers["keep"] == nil {
				t.Fatal("Removed records reappeared or unrelated resume data was lost")
			}
			if _, err := os.Stat(local); err != nil {
				t.Fatal("Record removal touched the source file")
			}
		})
	}
}

func TestClearRetainedRecordKeepsStaging(t *testing.T) {
	a := NewAppService(BuildInfo{Development: true}, nil)
	filename := filepath.Join(t.TempDir(), ".termquay-download-partial")
	if err := os.WriteFile(filename, []byte("partial"), 0600); err != nil {
		t.Fatal(err)
	}
	a.transfers["download"] = &transferTask{view: Transfer{State: "cancelled"}, resume: &transferResume{temporary: filename}}
	if _, err := a.ClearTransfer("download"); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(filename); err != nil || string(data) != "partial" {
		t.Fatalf("Record removal changed staging: %v", err)
	}
}

func TestClearRetainedRecordPersistenceFailureKeepsRecord(t *testing.T) {
	a := testAppStore(t)
	if err := a.store.UpdateSecretSettings(map[string]string{"transfer_resumes": "invalid-json"}, nil); err != nil {
		t.Fatal(err)
	}
	task := &transferTask{view: Transfer{State: "cancelled"}, resume: &transferResume{}}
	a.transfers["retained"] = task
	if _, err := a.ClearTransfer("retained"); err == nil {
		t.Fatal("Persistence failure was hidden")
	}
	if a.transfers["retained"] != task || task.resumeClaimed {
		t.Fatal("Persistence failure lost or locked the record")
	}
}

func TestDiscardMissingLocalStaging(t *testing.T) {
	a := NewAppService(BuildInfo{Development: true}, nil)
	a.transfers["download"] = &transferTask{
		view: Transfer{State: "cancelled"}, spec: &transferSpec{direction: "download"},
		resume: &transferResume{temporary: filepath.Join(t.TempDir(), "removed"), partial: &savedTransferFile{}},
	}
	if err := a.DiscardTransferResume("download", ""); err != nil || len(a.transfers) != 0 {
		t.Fatalf("Missing local staging blocked cleanup: %v", err)
	}
}
