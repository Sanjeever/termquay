package monitor

import (
	_ "embed"
	"errors"
	"strconv"
	"strings"
	"time"
)

//go:embed linux.sh
var Script string

type Counter struct {
	Name      string   `json:"name"`
	Read      uint64   `json:"read"`
	Write     uint64   `json:"write"`
	ReadRate  *float64 `json:"read_rate"`
	WriteRate *float64 `json:"write_rate"`
}
type Sample struct {
	Time            time.Time `json:"time"`
	System          string    `json:"system"`
	CPUTotal        uint64    `json:"-"`
	CPUIdle         uint64    `json:"-"`
	CPU             *float64  `json:"cpu"`
	MemoryTotal     uint64    `json:"memory_total"`
	MemoryAvailable uint64    `json:"memory_available"`
	Network         []Counter `json:"network"`
	Disks           []Counter `json:"disks"`
}

func Parse(data []byte, now time.Time, previous *Sample) (Sample, error) {
	s := Sample{Time: now, Network: []Counter{}, Disks: []Counter{}}
	section := ""
	cpuFound := false
	availableFound := false
	parse := func(value string) (uint64, error) { return strconv.ParseUint(strings.TrimSuffix(value, ":"), 10, 64) }
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "[") {
			section = strings.TrimSpace(line)
			continue
		}
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		switch section {
		case "[system]":
			s.System = line
		case "[cpu]":
			if fields[0] != "cpu" || len(fields) < 9 {
				return s, errors.New("CPU 计数格式无效")
			}
			for i := 1; i <= 8; i++ {
				value, err := parse(fields[i])
				if err != nil {
					return s, err
				}
				s.CPUTotal += value
				if i == 4 || i == 5 {
					s.CPUIdle += value
				}
			}
			cpuFound = true
		case "[memory]":
			if fields[0] == "MemTotal:" || fields[0] == "MemAvailable:" {
				if len(fields) < 3 || fields[2] != "kB" {
					return s, errors.New("内存计数格式无效")
				}
				value, err := parse(fields[1])
				if err != nil {
					return s, err
				}
				if fields[0] == "MemTotal:" {
					s.MemoryTotal = value * 1024
				} else {
					s.MemoryAvailable = value * 1024
					availableFound = true
				}
			}
		case "[network]":
			if !strings.Contains(fields[0], ":") {
				continue
			}
			if len(fields) < 17 {
				return s, errors.New("网络计数格式无效")
			}
			name := strings.TrimSuffix(fields[0], ":")
			if name == "lo" {
				continue
			}
			received, err := parse(fields[1])
			if err != nil {
				return s, err
			}
			sent, err := parse(fields[9])
			if err != nil {
				return s, err
			}
			s.Network = append(s.Network, Counter{Name: name, Read: received, Write: sent})
		case "[disk]":
			if len(fields) < 14 {
				return s, errors.New("磁盘计数格式无效")
			}
			read, err := parse(fields[5])
			if err != nil {
				return s, err
			}
			write, err := parse(fields[9])
			if err != nil {
				return s, err
			}
			name := fields[2]
			if strings.HasPrefix(name, "loop") || strings.HasPrefix(name, "ram") {
				continue
			}
			s.Disks = append(s.Disks, Counter{Name: name, Read: read * 512, Write: write * 512})
		}
	}
	if !cpuFound || s.MemoryTotal == 0 || !availableFound || s.System == "" {
		return s, errors.New("采集缺少必要 Linux 指标")
	}
	if previous != nil && now.After(previous.Time) {
		seconds := now.Sub(previous.Time).Seconds()
		if s.CPUTotal > previous.CPUTotal && s.CPUIdle >= previous.CPUIdle {
			total, idle := s.CPUTotal-previous.CPUTotal, s.CPUIdle-previous.CPUIdle
			if idle <= total {
				usage := 100 * (1 - float64(idle)/float64(total))
				s.CPU = &usage
			}
		}
		rates := func(current []Counter, old []Counter) {
			before := map[string]Counter{}
			for _, c := range old {
				before[c.Name] = c
			}
			for i, c := range current {
				p, ok := before[c.Name]
				if !ok {
					continue
				}
				if c.Read >= p.Read {
					rate := float64(c.Read-p.Read) / seconds
					current[i].ReadRate = &rate
				}
				if c.Write >= p.Write {
					rate := float64(c.Write-p.Write) / seconds
					current[i].WriteRate = &rate
				}
			}
		}
		rates(s.Network, previous.Network)
		rates(s.Disks, previous.Disks)
	}
	return s, nil
}
