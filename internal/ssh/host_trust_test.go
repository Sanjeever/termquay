package ssh

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	gossh "golang.org/x/crypto/ssh"
)

func TestMultipleHostTrustStillRejectsChangedKey(t *testing.T) {
	request, _ := localServer(t)
	original := request.Fingerprint
	encoded, err := json.Marshal([]HostTrust{{Algorithm: gossh.KeyAlgoED25519, Fingerprint: "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}, {Algorithm: gossh.KeyAlgoED25519, Fingerprint: original}})
	if err != nil {
		t.Fatal(err)
	}
	request.Fingerprint = string(encoded)
	verified := ""
	request = WithVerifiedHostKey(request, func(fingerprint string) { verified = fingerprint })
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	term, err := Dial(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	term.Close()
	if verified != original {
		t.Fatal("会话身份没有记录实际协商并验证的密钥")
	}
	request.Fingerprint = `[{"algorithm":"ssh-ed25519","fingerprint":"SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}]`
	_, err = Dial(ctx, request)
	var identity *HostKeyError
	if !errors.As(err, &identity) || identity.Fingerprint != original {
		t.Fatalf("多密钥校验放过了身份变化: %v", err)
	}
	algorithms := trustedAlgorithms([]HostTrust{{Algorithm: gossh.KeyAlgoRSA}})
	if algorithms[0] != gossh.KeyAlgoRSASHA512 || algorithms[1] != gossh.KeyAlgoRSASHA256 {
		t.Fatal("未优先协商已导入的 RSA SHA2 密钥")
	}
}
