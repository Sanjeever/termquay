package ssh

import (
	"fmt"
	"time"

	gossh "golang.org/x/crypto/ssh"
)

type ConnectionError struct {
	Stage     string
	Err       error
	Retryable bool
}

func (e *ConnectionError) Error() string { return fmt.Sprintf("%s失败：%v", e.Stage, e.Err) }
func (e *ConnectionError) Unwrap() error { return e.Err }

func keepAlive(client *gossh.Client) {
	done := make(chan struct{})
	go func() { client.Wait(); close(done) }()
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			result := make(chan error, 1)
			go func() { _, _, err := client.SendRequest("keepalive@openssh.com", true, nil); result <- err }()
			timer := time.NewTimer(10 * time.Second)
			select {
			case err := <-result:
				timer.Stop()
				if err != nil {
					client.Close()
					return
				}
			case <-done:
				timer.Stop()
				return
			case <-timer.C:
				client.Close()
				return
			}
		}
	}
}
