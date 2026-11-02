//go:build !windows

package ssh

import (
	"net"
	"path/filepath"
	"testing"
)

func testAgentListener(t *testing.T) (net.Listener, string) {
	t.Helper()
	address := filepath.Join(t.TempDir(), "agent.sock")
	listener, err := net.Listen("unix", address)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	return listener, address
}
