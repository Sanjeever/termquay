package main

import "errors"

func (a *AppService) GetTransferRate() int64 { return a.transferRate.Load() / 1024 }

func (a *AppService) SetTransferRate(kibPerSecond int64) error {
	if kibPerSecond < 0 || kibPerSecond > 1<<20 {
		return errors.New("限速须为 0 至 1048576 KiB/s，0 表示不限速")
	}
	a.transferRate.Store(kibPerSecond * 1024)
	return nil
}
