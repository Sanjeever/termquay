package app

import (
	"context"
	"crypto/rand"
	"errors"
	"io/fs"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Sanjeever/termquay/internal/rdp"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"github.com/Sanjeever/termquay/internal/store"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
	"github.com/wailsapp/wails/v3/pkg/updater"
)

type OpenResult struct {
	Route         []SSHRouteHop             `json:"route,omitempty"`
	Steps         []terminal.ConnectionStep `json:"steps"`
	ID            string                    `json:"id"`
	Fingerprint   string                    `json:"fingerprint"`
	TrustRequired bool                      `json:"trust_required"`
	TrustHost     string                    `json:"trust_host,omitempty"`
	TrustPort     int                       `json:"trust_port,omitempty"`
	TrustVia      string                    `json:"trust_via,omitempty"`
	TrustRole     string                    `json:"trust_role,omitempty"`
}

type pendingTerminal struct {
	terminal  *terminal.Terminal
	timer     *time.Timer
	attached  bool
	workspace string
}

type workspaceOwner struct {
	browseOnly bool
	target     string
	identity   string
	terminal   *terminal.Terminal
	ctx        context.Context
	cancel     context.CancelFunc
	timer      *time.Timer
	stream     *application.StreamConn
	opening    int
	route      []latencyHop
}

type AppService struct {
	build                  BuildInfo
	licenseFiles           fs.ReadFileFS
	importPreview          *SSHImportPreview
	mu                     sync.Mutex
	terminals              map[string]*pendingTerminal
	workspaces             map[string]*workspaceOwner
	trusted                map[string]string
	pendingTrust           map[string]string
	opening                int
	closed                 bool
	rdp                    *rdp.Bridge
	storeMu                sync.Mutex
	store                  *store.Store
	sessionDir             string
	backupMu               sync.Mutex
	preview                *pendingRestore
	fileSlots              chan struct{}
	imageMu                sync.Mutex
	imageSlots             chan struct{}
	imagePending           int
	imagePreviews          map[string]*imagePreviewData
	imageBytes             int64
	imagePixels            int64
	monitors               map[string]context.CancelFunc
	transfers              map[string]*transferTask
	transferPersistenceMu  sync.Mutex
	transferResumesLoaded  bool
	transferQueue          []string
	transferSequence       uint64
	transferEvent          func(Transfer)
	uploadPreview          *pendingUpload
	fileClipboard          *remoteFileClipboard
	fileClipboardMu        sync.Mutex
	syncPlans              map[string]*directorySyncPlan
	syncOpening            int
	dirty                  map[string]bool
	views                  map[string]bool
	allowQuit              bool
	frontendReady          bool
	privateKeys            map[string]stagedPrivateKey
	tunnels                map[string]*workspaceTunnel
	closing                int
	trustEpoch             map[string]uint64
	trustReviews           map[string]TrustReview
	pendingTrustAt         map[string]time.Time
	pendingTrustGeneration map[string]uint64
	sshChallenges          map[string]*sshAuthentication
	transferRate           atomic.Int64
	commandSlots           chan struct{}
	commandRuns            map[string]*commandRun
	containerTerminals     map[string]*containerTerminal
	automaticMu            sync.Mutex
	automaticConfig        *automaticBackupConfig
	automaticStatus        AutomaticBackupStatus
	automaticLoaded        bool
	automaticSignal        chan struct{}
	automaticStop          context.CancelFunc
	automaticTaskCancel    context.CancelFunc
	automaticDone          chan struct{}
	locals                 map[string]*localTerminal
	localOpening           int
	notificationMu         sync.Mutex
	notifications          *notifications.NotificationService
	latencyProbes          map[string]*latencyProbe
	updateMu               sync.Mutex
	updateEngine           *updater.Updater
	updateStatus           UpdateStatus
	updateContext          context.Context
	updateStop             context.CancelFunc
	updateCancel           context.CancelFunc
	updateWorkers          sync.WaitGroup
	updateWake             chan struct{}
	updateStarted          bool
	updateStopped          bool
	updateBusy             bool
	updateRestarting       bool
}

func NewAppService(build BuildInfo, licenses fs.ReadFileFS) *AppService {
	return &AppService{build: build, licenseFiles: licenses, terminals: map[string]*pendingTerminal{}, workspaces: map[string]*workspaceOwner{}, trusted: map[string]string{}, pendingTrust: map[string]string{}, fileSlots: make(chan struct{}, 4), imageSlots: make(chan struct{}, 2), monitors: map[string]context.CancelFunc{}, transfers: map[string]*transferTask{}, dirty: map[string]bool{}, views: map[string]bool{}, syncPlans: map[string]*directorySyncPlan{}, privateKeys: map[string]stagedPrivateKey{}, tunnels: map[string]*workspaceTunnel{}, transferEvent: func(view Transfer) { application.Get().Event.Emit("transfer:changed", view) }}
}

func (a *AppService) CloseWorkspace(id string) {
	a.mu.Lock()
	owner := a.workspaces[id]
	delete(a.workspaces, id)
	if a.uploadPreview != nil && a.uploadPreview.view.Workspace == id {
		a.uploadPreview = nil
	}
	if a.fileClipboard != nil && a.fileClipboard.workspace == id {
		a.fileClipboard = nil
	}
	if owner != nil {
		a.closing++
		defer func() { a.mu.Lock(); a.closing--; a.mu.Unlock() }()
	}
	forwarding := []*workspaceTunnel{}
	for key, t := range a.tunnels {
		if t.view.Workspace == id {
			t.cancel()
			forwarding = append(forwarding, t)
			delete(a.tunnels, key)
		}
	}
	if owner != nil {
		owner.cancel()
	}
	for key, p := range a.syncPlans {
		if p.workspace == id {
			delete(a.syncPlans, key)
		}
	}
	pendingTransfers := []<-chan struct{}{}
	for _, task := range a.transfers {
		if task.view.Workspace == id {
			a.cancelTransferLocked(task)
			pendingTransfers = append(pendingTransfers, task.done)
		}
	}
	cancel := a.monitors[id]
	delete(a.monitors, id)
	terminals := []*pendingTerminal{}
	for key, p := range a.terminals {
		if p.workspace == id {
			terminals = append(terminals, p)
			delete(a.terminals, key)
		}
	}
	containers := []*containerTerminal{}
	for key, p := range a.containerTerminals {
		if p.workspace == id {
			containers = append(containers, p)
			delete(a.containerTerminals, key)
		}
	}
	a.mu.Unlock()
	for _, console := range containers {
		console.close()
	}
	a.releaseWorkspaceImages(id)
	for _, t := range forwarding {
		if t.forward != nil {
			t.forward.Close()
		}
	}
	if cancel != nil {
		cancel()
	}
	for _, p := range terminals {
		p.timer.Stop()
	}
	wait, cancelWait := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelWait()
	for _, done := range pendingTransfers {
		select {
		case <-done:
		case <-wait.Done():
		}
	}
	if owner != nil {
		owner.timer.Stop()
		if owner.stream != nil {
			owner.stream.Close()
		}
		owner.terminal.Disconnect()
	}
	for _, p := range terminals {
		p.terminal.Close()
	}
}

func (a *AppService) ServiceShutdown() (result error) {
	result = errors.Join(result, a.stopUpdates())
	defer func() { result = errors.Join(result, a.closeNotifications()) }()
	defer func() { result = errors.Join(result, a.cleanupLocalTransferResumes()) }()
	a.mu.Lock()
	a.closed = true
	commandRuns := make([]*commandRun, 0, len(a.commandRuns))
	for _, run := range a.commandRuns {
		run.cancel()
		commandRuns = append(commandRuns, run)
	}
	for _, probe := range a.latencyProbes {
		probe.cancel()
	}
	localIDs := []string{}
	for id := range a.locals {
		localIDs = append(localIDs, id)
	}
	for id, key := range a.privateKeys {
		key.timer.Stop()
		clear(key.data)
		delete(a.privateKeys, id)
	}
	ids := make([]string, 0, len(a.workspaces))
	for id := range a.workspaces {
		ids = append(ids, id)
	}
	a.mu.Unlock()
	a.stopAutomaticBackup()
	for _, id := range localIDs {
		a.CloseLocalTerminal(id)
	}
	for _, id := range ids {
		a.CloseWorkspace(id)
	}
	a.mu.Lock()
	transferDone := make([]<-chan struct{}, 0, len(a.transfers))
	for _, task := range a.transfers {
		transferDone = append(transferDone, task.done)
	}
	a.mu.Unlock()
	transferWait, cancelTransferWait := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelTransferWait()
	for _, done := range transferDone {
		select {
		case <-done:
		case <-transferWait.Done():
			result = errors.Join(result, errors.New("退出时传输记录尚未完成保存"))
		}
	}
	for _, run := range commandRuns {
		<-run.done
	}
	if a.rdp != nil {
		a.rdp.Close()
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if a.store != nil {
		if err := a.store.Close(); err != nil {
			return errors.Join(result, err)
		}
	}
	if a.sessionDir != "" {
		return errors.Join(result, os.RemoveAll(a.sessionDir))
	}
	return result
}

func randomBytes(n int) []byte {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return b
}
