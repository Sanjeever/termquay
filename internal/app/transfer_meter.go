package app

import "time"

type transferSample struct {
	at        time.Time
	completed int64
}

type transferMeter struct {
	samples [5]transferSample
	next    int
	count   int
}

func (m *transferMeter) sample(now time.Time, completed int64) int64 {
	m.samples[m.next] = transferSample{at: now, completed: completed}
	m.next = (m.next + 1) % len(m.samples)
	if m.count < len(m.samples) {
		m.count++
	}
	oldest := m.samples[(m.next+len(m.samples)-m.count)%len(m.samples)]
	elapsed := now.Sub(oldest.at)
	if elapsed <= 0 || completed <= oldest.completed {
		return 0
	}
	return int64(float64(completed-oldest.completed) / elapsed.Seconds())
}
