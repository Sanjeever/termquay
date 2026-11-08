package ssh

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"slices"
	"strings"

	gossh "golang.org/x/crypto/ssh"
)

type HostTrust struct {
	Algorithm   string `json:"algorithm"`
	Fingerprint string `json:"fingerprint"`
}

func DecodeHostTrust(value string) ([]HostTrust, error) {
	if value == "" {
		return nil, nil
	}
	if strings.HasPrefix(value, "SHA256:") {
		return []HostTrust{{Fingerprint: value}}, nil
	}
	var keys []HostTrust
	if err := json.Unmarshal([]byte(value), &keys); err != nil || len(keys) == 0 || len(keys) > 16 {
		return nil, errors.New("SSH 信任记录格式无效")
	}
	for _, key := range keys {
		if !slices.Contains([]string{gossh.KeyAlgoED25519, gossh.KeyAlgoECDSA256, gossh.KeyAlgoECDSA384, gossh.KeyAlgoECDSA521, gossh.KeyAlgoRSA, ""}, key.Algorithm) || !strings.HasPrefix(key.Fingerprint, "SHA256:") {
			return nil, errors.New("SSH 信任记录算法或指纹无效")
		}
	}
	return keys, nil
}

func hostTrustMatches(keys []HostTrust, key gossh.PublicKey) bool {
	fingerprint := gossh.FingerprintSHA256(key)
	for _, trusted := range keys {
		if (trusted.Algorithm == "" || trusted.Algorithm == key.Type()) && subtle.ConstantTimeCompare([]byte(fingerprint), []byte(trusted.Fingerprint)) == 1 {
			return true
		}
	}
	return false
}

func trustedAlgorithms(keys []HostTrust) []string {
	algorithms := []string{gossh.KeyAlgoED25519, gossh.KeyAlgoECDSA256, gossh.KeyAlgoECDSA384, gossh.KeyAlgoECDSA521, gossh.KeyAlgoRSASHA512, gossh.KeyAlgoRSASHA256}
	preferred := []string{}
	for _, algorithm := range algorithms {
		for _, key := range keys {
			if key.Algorithm == algorithm || key.Algorithm == gossh.KeyAlgoRSA && (algorithm == gossh.KeyAlgoRSASHA512 || algorithm == gossh.KeyAlgoRSASHA256) {
				preferred = append(preferred, algorithm)
				break
			}
		}
	}
	for _, algorithm := range algorithms {
		if !slices.Contains(preferred, algorithm) {
			preferred = append(preferred, algorithm)
		}
	}
	return preferred
}
