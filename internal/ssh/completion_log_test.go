package ssh

import (
	"bytes"
	"testing"
)

func TestCompletionLogFilter(t *testing.T) {
	input := []byte("before\x1b[31mred\x1b[0m\x1b]777;termquay;token;S;private\aafter\x1b]7;file:///tmp\a")
	expected := []byte("before\x1b[31mred\x1b[0mafter\x1b]7;file:///tmp\a")
	for split := 0; split <= len(input); split++ {
		var filter completionLogFilter
		actual := append([]byte(nil), filter.filter(input[:split])...)
		actual = append(actual, filter.filter(input[split:])...)
		if !bytes.Equal(actual, expected) {
			t.Fatalf("split %d: %q", split, actual)
		}
	}
	var filter completionLogFilter
	if actual := filter.filter([]byte("\x1b]777;termquay;secret\x1b\\visible")); string(actual) != "visible" {
		t.Fatalf("ST termination: %q", actual)
	}
}
