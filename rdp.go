package main

import (
	"context"
	"errors"

	"github.com/Sanjeever/termquay/internal/rdp"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type RDPProbe struct {
	Fingerprint   string `json:"fingerprint"`
	TrustRequired bool   `json:"trust_required"`
	Reason        string `json:"reason"`
}

func (a *AppService) ProbeRDP(ctx context.Context, host string, port int) (RDPProbe, error) {
	target := rdp.Target{Host: host, Port: port}
	address := "rdp:" + target.Address()
	a.mu.Lock()
	target.Fingerprint = a.trusted[address]
	a.mu.Unlock()
	value, err := rdp.Probe(ctx, target)
	if err != nil {
		var cert *rdp.CertificateError
		if errors.As(err, &cert) {
			a.mu.Lock()
			a.pendingTrust[address] = cert.Fingerprint
			a.mu.Unlock()
			return RDPProbe{Fingerprint: cert.Fingerprint, TrustRequired: true, Reason: cert.Reason}, nil
		}
		return RDPProbe{}, err
	}
	return RDPProbe{Fingerprint: value}, nil
}

func (a *AppService) TrustRDPCertificate(host string, port int, fingerprint string) error {
	address := "rdp:" + (rdp.Target{Host: host, Port: port}).Address()
	a.mu.Lock()
	defer a.mu.Unlock()
	if fingerprint == "" || a.pendingTrust[address] != fingerprint || a.trusted[address] != "" {
		return errors.New("RDP 证书信任请求无效")
	}
	a.trusted[address] = fingerprint
	delete(a.pendingTrust, address)
	return nil
}

func (a *AppService) OpenRDP(host string, port int) (rdp.Grant, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closed {
		return rdp.Grant{}, errors.New("应用正在关闭")
	}
	if a.rdp == nil {
		b, err := rdp.NewBridge([]string{"wails://localhost", "http://wails.localhost", "http://127.0.0.1:9245", "http://localhost:9245"}, func(id, message string) {
			application.Get().Event.Emit("rdp:error", map[string]string{"id": id, "error": message})
		})
		if err != nil {
			return rdp.Grant{}, err
		}
		a.rdp = b
	}
	target := rdp.Target{Host: host, Port: port}
	target.Fingerprint = a.trusted["rdp:"+target.Address()]
	return a.rdp.Create(target)
}

func (a *AppService) CloseRDP(id string) {
	a.mu.Lock()
	bridge := a.rdp
	a.mu.Unlock()
	if bridge != nil {
		bridge.CloseSession(id)
	}
}
