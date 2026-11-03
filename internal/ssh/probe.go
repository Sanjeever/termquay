package ssh

import (
	"context"
	"errors"
	gossh "golang.org/x/crypto/ssh"
	"net"
	"strconv"
	"time"
)

func ProbeIdentity(ctx context.Context, host string, port int, jump *Request) (string, error) {
	return ProbeRequestIdentity(ctx, Request{Host: host, Port: port}, jump)
}

func ProbeRequestIdentity(ctx context.Context, request Request, jump *Request) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	address := net.JoinHostPort(request.Host, strconv.Itoa(request.Port))
	var conn net.Conn
	var err error
	if jump != nil {
		gateway, e := dialClient(ctx, *jump, func(ctx context.Context, addr string) (net.Conn, error) {
			return connectDirect(ctx, *jump, addr)
		})
		if e != nil {
			return "", e
		}
		defer gateway.Close()
		conn, err = gateway.DialContext(ctx, "tcp", address)
	} else {
		conn, err = connectDirect(ctx, request, address)
	}
	if err != nil {
		return "", err
	}
	defer conn.Close()
	stop := context.AfterFunc(ctx, func() { conn.Close() })
	defer stop()
	sentinel := errors.New("身份探测完成")
	fingerprint := ""
	_, _, _, err = gossh.NewClientConn(conn, address, &gossh.ClientConfig{User: "identity-probe", HostKeyAlgorithms: []string{gossh.KeyAlgoED25519, gossh.KeyAlgoECDSA256, gossh.KeyAlgoECDSA384, gossh.KeyAlgoECDSA521, gossh.KeyAlgoRSASHA512, gossh.KeyAlgoRSASHA256}, HostKeyCallback: func(_ string, _ net.Addr, key gossh.PublicKey) error {
		fingerprint = gossh.FingerprintSHA256(key)
		return sentinel
	}})
	if fingerprint != "" && errors.Is(err, sentinel) {
		return fingerprint, nil
	}
	return "", err
}
