package ssh

import (
	"fmt"
	"github.com/Microsoft/go-winio"
	"net"
	"testing"
	"time"
)

func testAgentListener(t *testing.T) (net.Listener, string) {
	t.Helper()
	address := fmt.Sprintf(`\\.\pipe\termquay-agent-%d`, time.Now().UnixNano())
	listener, err := winio.ListenPipe(address, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	return listener, address
}
