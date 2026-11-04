//go:build !darwin

package app

func (a *AppService) TitlebarDoubleClick() error { return nil }
