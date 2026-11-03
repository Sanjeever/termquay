package main

import (
	"errors"
	"slices"

	terminal "github.com/Sanjeever/termquay/internal/ssh"
)

func (a *AppService) resolveSSHChain(target terminal.Request) ([]terminal.Request, error) {
	chain := []terminal.Request{target}
	if target.JumpID == "" {
		return chain, nil
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return nil, err
	}
	data, err := a.store.Read()
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	for id := target.JumpID; id != ""; {
		if seen[id] || len(chain) >= 5 {
			return nil, errors.New("SSH 跳板链存在循环或超过四跳")
		}
		seen[id] = true
		request, connection, err := a.requestFromData(data, id)
		if err != nil {
			return nil, err
		}
		if connection.Protocol != "ssh" {
			return nil, errors.New("跳板必须使用 SSH 配置")
		}
		chain = append(chain, request)
		id = request.JumpID
	}
	slices.Reverse(chain)
	return chain, nil
}
