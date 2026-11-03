package main

import (
	"encoding/json"
	"os"
	"runtime"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func (a *AppService) ExportDiagnostics() error {
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	a.mu.Lock()
	states := map[string]int{}
	for _, task := range a.transfers {
		states[task.view.State]++
	}
	report := map[string]any{"version": 1, "created_at": time.Now().UTC(), "os": runtime.GOOS, "architecture": runtime.GOARCH, "go_version": runtime.Version(), "goroutines": runtime.NumGoroutine(), "backend_heap_bytes": memory.HeapAlloc, "backend_reserved_bytes": memory.Sys, "workspaces": len(a.workspaces), "terminals": len(a.terminals), "tunnels": len(a.tunnels), "transfers": states}
	a.mu.Unlock()
	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	filename, err := application.Get().Dialog.SaveFile().SetMessage("导出脱敏诊断信息").SetFilename("termquay-diagnostics.json").PromptForSingleSelection()
	if err != nil || filename == "" {
		return err
	}
	return os.WriteFile(filename, data, 0600)
}
