package main

import (
	"context"
	"encoding/base64"
	"errors"
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
}

func parseTrust(key, fp string) (TrustRecord, error) {
	r := TrustRecord{Key: key, Fingerprint: fp}
	value := strings.TrimPrefix(key, "trust:")
	r.Protocol, value, _ = strings.Cut(value, ":")
	if r.Protocol != "ssh" && r.Protocol != "rdp" {
		return r, errors.New("信任类型无效")
	}
	if strings.HasPrefix(value, "via:") {
		r.Via, value, _ = strings.Cut(strings.TrimPrefix(value, "via:"), ":")
	}
	host, port, err := net.SplitHostPort(value)
	if err != nil {
		return r, err
	}
	r.Host = host
	r.Port, err = strconv.Atoi(port)
	if err != nil || r.Port < 1 || r.Port > 65535 {
		return r, errors.New("信任地址无效")
	}
	return r, nil
}
func trustCacheKey(r TrustRecord) string {
	if r.Protocol == "rdp" {
		return "rdp:" + net.JoinHostPort(r.Host, strconv.Itoa(r.Port))
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
		return errors.New("待核对身份达到上限")
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
		fp, err := rdp.Probe(ctx, rdp.Target{Host: r.Host, Port: r.Port, Fingerprint: expected})
		if err != nil {
			var cert *rdp.CertificateError
			if expected == "" && errors.As(err, &cert) {
				return cert.Fingerprint, nil
			}
		}
		return fp, err
	}
	var jump *terminal.Request
	if r.Via != "" {
		request, c, err := a.savedRequest(r.Via)
		if err != nil {
			return "", err
		}
		if c.Protocol != "ssh" || request.JumpID != "" {
			return "", errors.New("跳板引用已失效")
		}
		request.Fingerprint, err = a.readTrust("ssh:" + sshTrustKey(request.Host, request.Port, ""))
		if err != nil || request.Fingerprint == "" {
			return "", errors.New("请先核对跳板身份")
		}
		jump = &request
	}
	return terminal.ProbeIdentity(ctx, r.Host, r.Port, jump)
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
		return TrustReview{}, errors.New("探测已被更新或撤销")
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
		return TrustReview{}, errors.New("待审核信任达到上限")
	}
	review := TrustReview{ID: base64.RawURLEncoding.EncodeToString(randomBytes(18)), Record: r, Old: old, New: fp, expires: time.Now().Add(time.Minute), generation: generation}
	a.trustReviews[review.ID] = review
	return review, nil
}
func (a *AppService) ConfirmTrustReview(ctx context.Context, id string) error {
	a.mu.Lock()
	review, ok := a.trustReviews[id]
	a.mu.Unlock()
	if !ok || time.Now().After(review.expires) {
		return errors.New("信任审核已过期")
	}
	fp, err := a.probeTrust(ctx, review.Record, review.New)
	if err != nil {
		return err
	}
	if fp != review.New {
		return errors.New("身份再次变化，请重新探测")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	cache := trustCacheKey(review.Record)
	if a.trustEpoch[cache] != review.generation || time.Now().After(review.expires) {
		return errors.New("信任审核已失效")
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	old, err := a.store.Setting(review.Record.Key)
	if err != nil {
		return err
	}
	if old != review.Old {
		return errors.New("原信任记录已变化")
	}
	if err = a.store.SetSetting(review.Record.Key, review.New); err != nil {
		return err
	}
	a.trusted[cache] = review.New
	delete(a.pendingTrust, cache)
	delete(a.trustReviews, id)
	a.trustEpoch[cache]++
	return nil
}
