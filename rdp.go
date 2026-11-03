package main

import (
	"context"
	"errors"
	"net"
	"net/url"
	"os"

	"github.com/Sanjeever/termquay/internal/rdp"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type RDPProbe struct {
	Fingerprint   string `json:"fingerprint"`
	TrustRequired bool   `json:"trust_required"`
	Reason        string `json:"reason"`
}

type RDPLaunch struct {
	Grant    rdp.Grant `json:"grant"`
	Username string    `json:"username"`
	Password string    `json:"password"`
	Domain   string    `json:"domain"`
}

func (a *AppService) OpenSavedRDP(id string) (RDPLaunch, error) {
	r, c, err := a.savedRequest(id)
	if err != nil {
		return RDPLaunch{}, err
	}
	if c.Protocol != "rdp" {
		return RDPLaunch{}, errors.New("所选连接不是 RDP")
	}
	if r.PrivateKey != "" {
		return RDPLaunch{}, errors.New("RDP 无法使用 SSH 私钥，请保存密码凭据")
	}
	grant, err := a.OpenRDP(r.Host, r.Port)
	if err != nil {
		return RDPLaunch{}, err
	}
	return RDPLaunch{Grant: grant, Username: r.Username, Password: r.Password, Domain: c.Domain}, nil
}

func (a *AppService) ProbeRDP(ctx context.Context, host string, port int) (RDPProbe, error) {
	target := rdp.Target{Host: host, Port: port}
	address := "rdp:" + target.Address()
	a.mu.Lock()
	generation := a.trustEpoch[address]
	a.mu.Unlock()
	stored, err := a.readTrust(address)
	if err != nil {
		return RDPProbe{}, err
	}
	a.mu.Lock()
	if generation != a.trustEpoch[address] {
		a.mu.Unlock()
		return RDPProbe{}, errors.New("证书探测已失效")
	}
	if stored != "" {
		a.trusted[address] = stored
	}
	target.Fingerprint = a.trusted[address]
	a.mu.Unlock()
	value, err := rdp.Probe(ctx, target)
	if err != nil {
		var cert *rdp.CertificateError
		if errors.As(err, &cert) {
			a.mu.Lock()
			if generation != a.trustEpoch[address] {
				a.mu.Unlock()
				return RDPProbe{}, errors.New("证书探测已失效")
			}
			if err = a.setPendingTrustLocked(address, cert.Fingerprint); err != nil {
				a.mu.Unlock()
				return RDPProbe{}, err
			}
			a.mu.Unlock()
			return RDPProbe{Fingerprint: cert.Fingerprint, TrustRequired: true, Reason: cert.Reason}, nil
		}
		return RDPProbe{}, err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if generation != a.trustEpoch[address] {
		return RDPProbe{}, errors.New("证书探测已失效")
	}
	if known := a.trusted[address]; known != "" && known != value {
		return RDPProbe{}, errors.New("RDP 证书已变化，连接已阻止")
	}
	if err := a.saveTrust(address, value); err != nil {
		return RDPProbe{}, err
	}
	a.trusted[address] = value
	return RDPProbe{Fingerprint: value}, nil
}

func (a *AppService) TrustRDPCertificate(host string, port int, fingerprint string) error {
	address := "rdp:" + (rdp.Target{Host: host, Port: port}).Address()
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.pendingTrustValidLocked(address, fingerprint) || a.trusted[address] != "" {
		return errors.New("RDP 证书信任请求无效")
	}
	if err := a.saveTrust(address, fingerprint); err != nil {
		return err
	}
	a.trusted[address] = fingerprint
	delete(a.pendingTrust, address)
	delete(a.pendingTrustAt, address)
	delete(a.pendingTrustGeneration, address)
	return nil
}

func rdpOrigins() []string {
	origins := []string{"wails://localhost", "http://wails.localhost"}
	frontend, err := url.Parse(os.Getenv("FRONTEND_DEVSERVER_URL"))
	if err == nil && (frontend.Scheme == "http" || frontend.Scheme == "https") && (frontend.Hostname() == "localhost" || net.ParseIP(frontend.Hostname()).IsLoopback()) {
		origins = append(origins, frontend.Scheme+"://"+frontend.Host)
		if port := frontend.Port(); port != "" {
			origins = append(origins, "http://wails.localhost:"+port, "wails://localhost:"+port)
		}
	}
	return origins
}

func (a *AppService) OpenRDP(host string, port int) (rdp.Grant, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closed {
		return rdp.Grant{}, errors.New("应用正在关闭")
	}
	if a.rdp == nil {
		b, err := rdp.NewBridge(rdpOrigins(), func(id string, closedErr error) {
			if closedErr == nil {
				application.Get().Event.Emit("rdp:closed", map[string]string{"id": id})
			} else {
				application.Get().Event.Emit("rdp:error", map[string]string{"id": id, "error": closedErr.Error()})
			}
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
