package main

import (
	"context"
	"errors"
	"time"

	"github.com/Sanjeever/termquay/internal/monitor"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type MonitorEvent struct {
	ID     string          `json:"id"`
	Sample *monitor.Sample `json:"sample"`
	Error  string          `json:"error"`
}

func init() { application.RegisterEvent[MonitorEvent]("monitor:sample") }

func (a *AppService) SubscribeMonitor(id string) error {
	a.mu.Lock()
	p := a.workspaces[id]
	if p == nil {
		a.mu.Unlock()
		return errors.New("SSH 工作区已关闭")
	}
	t := p.terminal
	if a.monitors[id] != nil {
		a.mu.Unlock()
		return nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	a.monitors[id] = cancel
	a.mu.Unlock()
	go func() {
		var previous *monitor.Sample
		for {
			select {
			case <-ctx.Done():
				return
			default:
			}
			request, stop := context.WithTimeout(ctx, 10*time.Second)
			data, err := t.Exec(request, monitor.Script, 256<<10)
			stop()
			if ctx.Err() != nil {
				return
			}
			event := MonitorEvent{ID: id}
			if err == nil {
				sample, parseErr := monitor.Parse(data, time.Now(), previous)
				err = parseErr
				if err == nil {
					event.Sample = &sample
					previous = &sample
				}
			}
			if err != nil {
				event.Error = err.Error()
				previous = nil
			}
			application.Get().Event.Emit("monitor:sample", event)
			timer := time.NewTimer(3 * time.Second)
			select {
			case <-ctx.Done():
				timer.Stop()
				return
			case <-timer.C:
			}
		}
	}()
	return nil
}

func (a *AppService) UnsubscribeMonitor(id string) {
	a.mu.Lock()
	cancel := a.monitors[id]
	delete(a.monitors, id)
	a.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}
