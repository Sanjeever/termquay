package app

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"github.com/Sanjeever/termquay/internal/store"
	"github.com/wailsapp/wails/v3/pkg/application"
	gossh "golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

type KnownHostsRow struct {
	ID       string               `json:"id"`
	Host     string               `json:"host"`
	Port     int                  `json:"port"`
	Via      string               `json:"via"`
	Keys     []terminal.HostTrust `json:"keys"`
	OldKeys  []terminal.HostTrust `json:"old_keys"`
	Conflict bool                 `json:"conflict"`
	key      string
	epoch    uint64
	existing string
}

type KnownHostsPreview struct {
	ID              string                   `json:"id"`
	Rows            []KnownHostsRow          `json:"rows"`
	Warnings        []string                 `json:"warnings"`
	WarningMessages []*appmessage.Descriptor `json:"warning_messages,omitempty"`
	base            store.Data
	expires         time.Time
}

func (a *AppService) SelectKnownHostsImport() (KnownHostsPreview, error) {
	dialog := application.Get().Dialog.OpenFile().SetTitle(nativeText("Select OpenSSH known_hosts", "选择 OpenSSH known_hosts"))
	if home, err := os.UserHomeDir(); err == nil {
		dialog.SetDirectory(filepath.Join(home, ".ssh"))
	}
	name, err := dialog.PromptForSingleSelection()
	if err != nil {
		return KnownHostsPreview{}, err
	}
	if name == "" {
		return KnownHostsPreview{}, appmessage.New("backend:noKnownHostsFileSelected", "未选择 known_hosts")
	}
	file, err := os.Open(name)
	if err != nil {
		return KnownHostsPreview{}, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, (1<<20)+1))
	if err != nil {
		return KnownHostsPreview{}, err
	}
	return a.PreviewKnownHostsImport(string(data))
}

func (a *AppService) PreviewKnownHostsImport(text string) (KnownHostsPreview, error) {
	if len(text) > 1<<20 {
		return KnownHostsPreview{}, appmessage.New("backend:knownHostsExceeds1MiB", "known_hosts 超过 1 MiB")
	}
	file, err := os.CreateTemp("", "termquay-known-hosts-*")
	if err != nil {
		return KnownHostsPreview{}, err
	}
	defer os.Remove(file.Name())
	if _, err := io.WriteString(file, text); err != nil {
		file.Close()
		return KnownHostsPreview{}, err
	}
	if err := file.Close(); err != nil {
		return KnownHostsPreview{}, err
	}
	check, err := knownhosts.New(file.Name())
	if err != nil {
		return KnownHostsPreview{}, appmessage.New("backend:invalidKnownHostsSyntax", "known_hosts 语法无效")
	}
	a.mu.Lock()
	epochs := map[string]uint64{}
	for key, value := range a.trustEpoch {
		epochs[key] = value
	}
	a.mu.Unlock()
	a.storeMu.Lock()
	if err := a.openStorage(); err != nil {
		a.storeMu.Unlock()
		return KnownHostsPreview{}, err
	}
	data, err := a.store.Read()
	a.storeMu.Unlock()
	if err != nil {
		return KnownHostsPreview{}, err
	}
	targets := map[string]KnownHostsRow{}
	add := func(host string, port int, via string) error {
		if host == "" || port < 1 || port > 65535 || strings.ContainsAny(host, "*?!|\r\n\x00") {
			return nil
		}
		key := sshTrustKey(host, port, via)
		targets[key] = KnownHostsRow{Host: host, Port: port, Via: via, key: key, epoch: epochs[key]}
		if len(targets) > 1024 {
			return appmessage.New("backend:candidateHostCountExceeds1024ImportInBatches", "候选主机超过 1024 项，请分批导入")
		}
		return nil
	}
	for _, connection := range data.Connections {
		if connection.Protocol == "ssh" {
			if err := add(connection.Host, connection.Port, connection.JumpID); err != nil {
				return KnownHostsPreview{}, err
			}
		}
	}
	warnings := []error{}
	revoked := map[string]bool{}
	rest := []byte(text)
	for count := 0; len(rest) > 0; count++ {
		if count >= 4096 {
			return KnownHostsPreview{}, appmessage.New("backend:knownHostsExceeds4096Entries", "known_hosts 超过 4096 条")
		}
		marker, hosts, key, _, next, err := gossh.ParseKnownHosts(rest)
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return KnownHostsPreview{}, appmessage.New("backend:invalidKnownHostsEntry", "known_hosts 条目无效")
		}
		rest = next
		if marker != "" {
			if marker == "revoked" {
				revoked[gossh.FingerprintSHA256(key)] = true
			}
			if len(warnings) < 64 {
				warnings = append(warnings, appmessage.Errorf("backend:skipHostMarker", "跳过 @%s 记录；撤销密钥不会导入为信任", marker))
			}
			continue
		}
		for _, host := range hosts {
			if strings.ContainsAny(host, "*?!|") {
				continue
			}
			port := 22
			if strings.HasPrefix(host, "[") {
				var value string
				host, value, err = net.SplitHostPort(host)
				if err != nil {
					return KnownHostsPreview{}, appmessage.New("backend:invalidKnownHostsPort", "known_hosts 端口无效")
				}
				port, err = strconv.Atoi(value)
				if err != nil {
					return KnownHostsPreview{}, err
				}
			}
			if err := add(host, port, ""); err != nil {
				return KnownHostsPreview{}, err
			}
		}
	}
	query, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return KnownHostsPreview{}, err
	}
	queryKey, err := gossh.NewPublicKey(query)
	if err != nil {
		return KnownHostsPreview{}, err
	}
	rows := []KnownHostsRow{}
	for _, row := range targets {
		address := net.JoinHostPort(row.Host, strconv.Itoa(row.Port))
		var mismatch *knownhosts.KeyError
		if err := check(address, &net.TCPAddr{IP: net.IPv4zero, Port: row.Port}, queryKey); !errors.As(err, &mismatch) {
			if err != nil {
				return KnownHostsPreview{}, appmessage.New("backend:knownHostsMatchingFailed", "known_hosts 匹配失败")
			}
			continue
		}
		for _, known := range mismatch.Want {
			key := terminal.HostTrust{Algorithm: known.Key.Type(), Fingerprint: gossh.FingerprintSHA256(known.Key)}
			if revoked[key.Fingerprint] || slices.Contains(row.Keys, key) {
				continue
			}
			encoded, _ := json.Marshal([]terminal.HostTrust{key})
			if _, err := terminal.DecodeHostTrust(string(encoded)); err != nil {
				continue
			}
			row.Keys = append(row.Keys, key)
		}
		if len(row.Keys) == 0 {
			continue
		}
		if len(row.Keys) > 16 {
			return KnownHostsPreview{}, appmessage.New("backend:moreThan16KeysForTheSameHost", "同一主机密钥超过 16 项")
		}
		sort.Slice(row.Keys, func(i, j int) bool {
			if row.Keys[i].Algorithm == row.Keys[j].Algorithm {
				return row.Keys[i].Fingerprint < row.Keys[j].Fingerprint
			}
			return row.Keys[i].Algorithm < row.Keys[j].Algorithm
		})
		a.storeMu.Lock()
		row.existing, err = a.store.Setting("trust:ssh:" + row.key)
		a.storeMu.Unlock()
		if err != nil {
			return KnownHostsPreview{}, err
		}
		old, err := terminal.DecodeHostTrust(row.existing)
		if err != nil {
			return KnownHostsPreview{}, err
		}
		row.OldKeys = old
		for _, previous := range old {
			if previous.Algorithm == "" {
				found := false
				for _, key := range row.Keys {
					if key.Fingerprint == previous.Fingerprint {
						found = true
					}
				}
				if !found {
					row.Conflict = true
				}
				continue
			}
			for _, key := range row.Keys {
				if key.Algorithm == previous.Algorithm && !slices.Contains(old, key) {
					row.Conflict = true
				}
			}
		}
		row.ID = base64.RawURLEncoding.EncodeToString(randomBytes(16))
		rows = append(rows, row)
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].key < rows[j].key })
	if len(rows) == 0 {
		return KnownHostsPreview{}, appmessage.New("backend:noOrdinaryHostKeysToImportHashedOr", "没有可导入的普通主机密钥；哈希及模式主机名需先有匹配的连接配置")
	}
	warnings = append(warnings, appmessage.New("backend:knownHostsScope", "哈希及模式主机名仅匹配已保存或文件中可识别的目标，不解析 DNS；跳板路径需分别选择。"))
	p := KnownHostsPreview{ID: base64.RawURLEncoding.EncodeToString(randomBytes(18)), Rows: rows, Warnings: nil, base: data, expires: time.Now().Add(10 * time.Minute)}
	appendImportNotices(&p.Warnings, &p.WarningMessages, warnings...)
	a.mu.Lock()
	a.knownHostsPreview = &p
	a.mu.Unlock()
	return p, nil
}

func (a *AppService) ConfirmKnownHostsImport(id string, choices []SSHImportChoice) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	p := a.knownHostsPreview
	if p == nil || p.ID != id || time.Now().After(p.expires) {
		return appmessage.New("backend:hostKeyPreviewNoLongerValid", "主机密钥预览已失效")
	}
	a.storeMu.Lock()
	defer a.storeMu.Unlock()
	data, err := a.store.Read()
	if err != nil {
		return err
	}
	if !reflect.DeepEqual(data, p.base) {
		return appmessage.New("backend:connectionConfigurationChangedPreviewAgain", "连接配置已变化，请重新预览")
	}
	selected := map[string]string{}
	for _, choice := range choices {
		if selected[choice.ID] != "" || (choice.Action != "new" && choice.Action != "replace" && choice.Action != "skip") {
			return appmessage.New("backend:invalidImportSelection", "导入选择无效")
		}
		selected[choice.ID] = choice.Action
	}
	settings := map[string]string{}
	for _, row := range p.Rows {
		action := selected[row.ID]
		delete(selected, row.ID)
		if action == "" || action == "skip" {
			continue
		}
		if row.Conflict && action != "replace" {
			return appmessage.New("backend:conflictingFingerprintsRequireExplicitReplacementSelection", "冲突指纹需显式选择替换")
		}
		old, err := a.store.Setting("trust:ssh:" + row.key)
		if err != nil {
			return err
		}
		if old != row.existing || a.trustEpoch[row.key] != row.epoch {
			return appmessage.New("backend:hostTrustChangedPreviewAgain", "主机信任已变化，请重新预览")
		}
		keys := append([]terminal.HostTrust(nil), row.Keys...)
		if action != "replace" {
			previous, err := terminal.DecodeHostTrust(old)
			if err != nil {
				return err
			}
			for _, key := range previous {
				found := false
				for _, current := range keys {
					if current.Fingerprint == key.Fingerprint {
						found = true
					}
				}
				if !found {
					keys = append(keys, key)
				}
			}
		}
		if len(keys) > 16 {
			return appmessage.New("backend:mergingWouldExceed16KeysForTheSame", "合并后同一主机密钥超过 16 项")
		}
		encoded, err := json.Marshal(keys)
		if err != nil {
			return err
		}
		settings["trust:ssh:"+row.key] = string(encoded)
	}
	if len(selected) > 0 {
		return appmessage.New("backend:importSelectionDoesNotBelongToThisPreview", "导入选择不属于当前预览")
	}
	if err := a.store.ImportTrustSettings(settings); err != nil {
		return err
	}
	if a.trustEpoch == nil {
		a.trustEpoch = map[string]uint64{}
	}
	for key, value := range settings {
		cache := strings.TrimPrefix(key, "trust:ssh:")
		a.trusted[cache] = value
		a.trustEpoch[cache]++
		delete(a.pendingTrust, cache)
		delete(a.pendingTrustAt, cache)
		delete(a.pendingTrustGeneration, cache)
	}
	a.knownHostsPreview = nil
	return nil
}
