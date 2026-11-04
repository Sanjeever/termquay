package ssh

import "bytes"

var completionPrefix = []byte("\x1b]777;termquay;")

type completionLogFilter struct {
	prefix  []byte
	private bool
	escaped bool
}

func (f *completionLogFilter) filter(data []byte) []byte {
	if !f.private && len(f.prefix) == 0 && !bytes.Contains(data, completionPrefix) {
		for size := min(len(data), len(completionPrefix)-1); size > 0; size-- {
			if bytes.HasSuffix(data, completionPrefix[:size]) {
				f.prefix = append(f.prefix, data[len(data)-size:]...)
				return data[:len(data)-size]
			}
		}
		return data
	}
	output := make([]byte, 0, len(data))
	for _, value := range data {
		if f.private {
			if value == '\a' || f.escaped && value == '\\' {
				f.private = false
			}
			f.escaped = value == '\x1b'
			continue
		}
		if len(f.prefix) != 0 {
			if value == completionPrefix[len(f.prefix)] {
				f.prefix = append(f.prefix, value)
				if len(f.prefix) == len(completionPrefix) {
					f.private, f.escaped = true, false
					f.prefix = f.prefix[:0]
				}
				continue
			}
			output = append(output, f.prefix...)
			f.prefix = f.prefix[:0]
		}
		if value == '\x1b' {
			f.prefix = append(f.prefix, value)
		} else {
			output = append(output, value)
		}
	}
	return output
}
