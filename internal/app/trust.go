package app

import (
	"context"
	"encoding/base64"
	"errors"
	appmessage "github.com/Sanjeever/termquay/internal/message"
	"github.com/Sanjeever/termquay/internal/rdp"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"net"
	"strconv"
	"strings"
	"time"
)

type TrustRecord struct {
	Key         string `json:"key"`
	Protocol    string `json:"protocol"`
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Via         string `json:"via"`
	Fingerprint string `json:"fingerprint"`
}
type TrustPage struct {
	Items []TrustRecord `json:"items"`
	Next  string        `json:"next"`
}
type TrustReview struct {
	ID         string      `json:"id"`
	Record     TrustRecord `json:"record"`
	Old        string      `json:"old"`
	New        string      `json:"new"`
	expires    time.Time
	generation uint64
	oldValue   string
}

func parseTrust(key, fp string) (TrustRecord, error) {
	r := TrustRecord{Key: key, Fingerprint: fp}
	if !strings.HasPrefix(key, "trust:") {
		return r, appmessage.New("backend:invalidTrustKey", "信任键无效")
	}
	value := strings.TrimPrefix(key, "trust:")
	r.Protocol, value, _ = strings.Cut(value, ":")
	if r.Protocol != "ssh" && r.Protocol != "rdp" {
		return r, appmessage.New("backend:invalidTrustType", "信任类型无效")
	}
	if r.Protocol == "ssh" && strings.HasPrefix(fp, "[") {
		keys, err := terminal.DecodeHostTrust(fp)
		if err != nil {
			return r, err
		}
		values := []string{}
		for _, key := range keys {
			values = append(values, key.Fingerprint)
		}
		r.Fingerprint = strings.Join(values, "\n")
	}
	if strings.HasPrefix(value, "via:") {
		r.Via, value, _ = strings.Cut(strings.TrimPrefix(value, "via:"), ":")
		if r.Via == "" {
			return r, appmessage.New("backend:invalidJumpHostTrust", "跳板信任无效")
		}
		if r.Protocol == "rdp" {
			value, err := base64.RawURLEncoding.DecodeString(r.Via)
			if err != nil || len(value) != 32 {
				return r, appmessage.New("backend:invalidRDPJumpHostTrust", "RDP 跳板信任无效")
			}
		}
	}
	host, port, err := net.SplitHostPort(value)
	if err != nil || host == "" {
		return r, appmessage.New("backend:invalidTrustAddress", "信任地址无效")
	}
	r.Host = host
	r.Port, err = strconv.Atoi(port)
	if err != nil || r.Port < 1 || r.Port > 65535 {
		return r, appmessage.New("backend:invalidTrustAddress", "信任地址无效")
	}
	return r, nil
}
func trustCacheKey(r TrustRecord) string {
	if r.Protocol == "rdp" {
		return rdpTrustAddress(rdp.Target{Host: r.Host, Port: r.Port, Scope: r.Via})
	}
	return sshTrustKey(r.Host, r.Port, r.Via)
}
func (a *AppService) setPendingTrustLocked(key, fp string) error {
	if a.pendingTrustAt == nil {
		a.pendingTrustAt = map[string]time.Time{}
		a.pendingTrustGeneration = map[string]uint64{}
	}
	for k, at := range a.pendingTrustAt {
		if time.Since(at) > 2*time.Minute {
			delete(a.pendingTrust, k)
			delete(a.pendingTrustAt, k)
			delete(a.pendingTrustGeneration, k)
		}
	}
	if len(a.pendingTrust) >= 128 && a.pendingTrust[key] == "" {
		return appmessage.New("backend:pendingIdentityReviewLimitReached", "待核对身份达到上限")
	}
	a.pendingTrust[key] = fp
	a.pendingTrustAt[key] = time.Now()
	a.pendingTrustGeneration[key] = a.trustEpoch[key]
	return nil
}
func (a *AppService) pendingTrustValidLocked(key, fp string) bool {
	return fp != "" && a.pendingTrust[key] == fp && time.Since(a.pendingTrustAt[key]) < 2*time.Minute && a.pendingTrustGeneration[key] == a.trustEpoch[key]
}
func (a *AppService) ListTrusts(after string) (TrustPage, error) {
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err := a.openStorage(); err != nil {
		return TrustPage{}, err
	}
	values, err := a.store.TrustSettings(after)
	if err != nil {
		return TrustPage{}, err
	}
	page := TrustPage{Items: []TrustRecord{}}
	if len(values) > 256 {
		page.Next = values[255].Key
		values = values[:256]
	}
	for _, v := range values {
		r, err := parseTrust(v.Key, v.Fingerprint)
		if err != nil {
			return page, err
		}
		page.Items = append(page.Items, r)
	}
	return page, nil
}
func (a *AppService) RevokeTrust(key string) error {
	r, err := parseTrust(key, "")
	if err != nil {
		return err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	if err = a.openStorage(); err != nil {
		return err
	}
	if err = a.store.SetSetting(key, ""); err != nil {
		return err
	}
	cache := trustCacheKey(r)
	delete(a.trusted, cache)
	delete(a.pendingTrust, cache)
	delete(a.pendingTrustAt, cache)
	delete(a.pendingTrustGeneration, cache)
	if a.trustEpoch == nil {
		a.trustEpoch = map[string]uint64{}
	}
	a.trustEpoch[cache]++
	for id, p := range a.trustReviews {
		if p.Record.Key == key {
			delete(a.trustReviews, id)
		}
	}
	if r.Protocol == "rdp" && a.rdp != nil {
		a.rdp.RevokePending(r.Host, r.Port)
	}
	return nil
}
func (a *AppService) probeTrust(ctx context.Context, r TrustRecord, expected string) (string, error) {
	if r.Protocol == "rdp" {
		target, err := a.rdpScopedTarget(r.Host, r.Port, r.Via)
		if err != nil {
			return "", err
		}
		target.Fingerprint = expected
		fp, err := rdp.Probe(ctx, target)
		if err != nil {
			var cert *rdp.CertificateError
			if expected == "" && errors.As(err, &cert) {
				return cert.Fingerprint, nil
			}
		}
		return fp, err
	}
	var hops []terminal.Request
	if r.Via != "" {
		request, c, err := a.savedRequest(r.Via)
		if err != nil {
			return "", err
		}
		if c.Protocol != "ssh" {
			return "", appmessage.New("backend:jumpHostReferenceNoLongerValid", "跳板引用已失效")
		}
		hops, err = a.resolveSSHChain(request)
		if err != nil {
			return "", err
		}
		for index, hop := range hops {
			hop.Fingerprint, err = a.readTrust("ssh:" + sshTrustKey(hop.Host, hop.Port, hop.JumpID))
			if err != nil || hop.Fingerprint == "" {
				return "", appmessage.New("backend:verifyAllJumpHostIdentitiesInTheChain", "请先核对链上所有跳板身份")
			}
			hops[index] = hop
		}
	}
	request := terminal.Request{Host: r.Host, Port: r.Port}
	if len(hops) == 0 {
		catalog, err := a.GetCatalog()
		if err != nil {
			return "", err
		}
		routes := map[string]bool{}
		for _, connection := range catalog.Connections {
			if connection.Protocol == "ssh" && connection.Host == r.Host && connection.Port == r.Port && connection.JumpID == "" {
				routes[connection.ProxyAddress] = true
			}
		}
		if len(routes) > 1 {
			return "", appmessage.New("backend:thisHostHasMultipleConnectionProxyRoutesSelect", "此主机有多个连接代理路径，请先明确使用的连接配置")
		}
		for address := range routes {
			request.ProxyAddress = address
		}
	}
	return terminal.ProbeChainIdentity(ctx, request, hops)
}
func (a *AppService) ProbeTrustReview(ctx context.Context, key string) (TrustReview, error) {
	r, err := parseTrust(key, "")
	if err != nil {
		return TrustReview{}, err
	}
	cache := trustCacheKey(r)
	a.mu.Lock()
	if a.trustEpoch == nil {
		a.trustEpoch = map[string]uint64{}
	}
	a.trustEpoch[cache]++
	generation := a.trustEpoch[cache]
	a.mu.Unlock()
	old, err := a.readTrust(strings.TrimPrefix(key, "trust:"))
	if err != nil {
		return TrustReview{}, err
	}
	fp, err := a.probeTrust(ctx, r, "")
	if err != nil {
		return TrustReview{}, err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if generation != a.trustEpoch[cache] {
		return TrustReview{}, appmessage.New("backend:probeWasUpdatedOrRevoked", "探测已被更新或撤销")
	}
	if a.trustReviews == nil {
		a.trustReviews = map[string]TrustReview{}
	}
	for id, p := range a.trustReviews {
		if time.Now().After(p.expires) || p.Record.Key == key {
			delete(a.trustReviews, id)
		}
	}
	if len(a.trustReviews) >= 32 {
		return TrustReview{}, appmessage.New("backend:pendingTrustReviewLimitReached", "待审核信任达到上限")
	}
	display, err := parseTrust(key, old)
	if err != nil {
		return TrustReview{}, err
	}
	review := TrustReview{ID: base64.RawURLEncoding.EncodeToString(randomBytes(18)), Record: r, Old: display.Fingerprint, oldValue: old, New: fp, expires: time.Now().Add(time.Minute), generation: generation}
	a.trustReviews[review.ID] = review
	return review, nil
}
func (a *AppService) ConfirmTrustReview(ctx context.Context, id string) error {
	a.mu.Lock()
	review, ok := a.trustReviews[id]
	a.mu.Unlock()
	if !ok || time.Now().After(review.expires) {
		return appmessage.New("backend:trustReviewExpired", "信任审核已过期")
	}
	fp, err := a.probeTrust(ctx, review.Record, review.New)
	if err != nil {
		return err
	}
	if fp != review.New {
		return appmessage.New("backend:identityChangedAgainProbeAgain", "身份再次变化，请重新探测")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	cache := trustCacheKey(review.Record)
	if a.trustEpoch[cache] != review.generation || time.Now().After(review.expires) {
		return appmessage.New("backend:trustReviewNoLongerValid", "信任审核已失效")
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	old, err := a.store.Setting(review.Record.Key)
	if err != nil {
		return err
	}
	if old != review.oldValue {
		return appmessage.New("backend:originalTrustRecordChanged", "原信任记录已变化")
	}
	if err = a.store.SetSetting(review.Record.Key, review.New); err != nil {
		return err
	}
	a.trusted[cache] = review.New
	delete(a.pendingTrust, cache)
	delete(a.pendingTrustAt, cache)
	delete(a.pendingTrustGeneration, cache)
	delete(a.trustReviews, id)
	a.trustEpoch[cache]++
	if review.Record.Protocol == "rdp" && a.rdp != nil {
		a.rdp.RevokePending(review.Record.Host, review.Record.Port)
	}
	return nil
}
