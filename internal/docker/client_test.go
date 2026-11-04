package docker

import (
	"context"
	"encoding/binary"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLogsRejectOversizedFrame(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/json") {
			w.Write([]byte(`{"Config":{"Tty":false},"Mounts":[]}`))
			return
		}
		header := make([]byte, 8)
		header[0] = 1
		binary.BigEndian.PutUint32(header[4:], ^uint32(0))
		w.Write(header)
	}))
	defer server.Close()
	client := New(nil)
	client.http = &http.Client{Transport: roundTripToServer{server.URL}}
	defer client.Close()
	if _, err := client.Logs(context.Background(), strings.Repeat("a", 64)); err == nil || !strings.Contains(err.Error(), "单帧") {
		t.Fatal("未在解复用前拒绝超大日志帧", err)
	}
}

type roundTripToServer struct{ url string }

func (r roundTripToServer) RoundTrip(request *http.Request) (*http.Response, error) {
	clone := request.Clone(request.Context())
	clone.URL.Scheme = "http"
	clone.URL.Host = strings.TrimPrefix(r.url, "http://")
	return http.DefaultTransport.RoundTrip(clone)
}
