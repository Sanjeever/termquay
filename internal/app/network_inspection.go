package app

import (
	"context"
	"errors"
	"net"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type LinuxPort struct {
	Protocol string `json:"protocol"`
	State    string `json:"state"`
	Address  string `json:"address"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	PIDs     []int  `json:"pids"`
	Process  string `json:"process"`
}
type LinuxPortList struct {
	Items     []LinuxPort `json:"items"`
	Truncated bool        `json:"truncated"`
	Warning   string      `json:"warning"`
	Time      time.Time   `json:"time"`
}

var socketPID = regexp.MustCompile(`pid=([0-9]+)`)

func (a *AppService) ListLinuxPorts(ctx context.Context, workspace string) (LinuxPortList, error) {
	result, err := a.inspectLinux(ctx, workspace, "exec ss -H -l -n -t -u -p")
	view := LinuxPortList{Items: []LinuxPort{}, Time: time.Now(), Truncated: result.Truncated, Warning: strings.TrimSpace(result.Stderr)}
	if err != nil {
		return view, err
	}
	data := result.Stdout
	if result.Truncated {
		data = data[:strings.LastIndex(data, "\n")+1]
	}
	for line := range strings.SplitSeq(data, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		if len(fields) < 6 || (fields[0] != "tcp" && fields[0] != "udp") {
			return view, errors.New("端口列表格式无效，需要 iproute2 ss")
		}
		if len(view.Items) == maxInspectionItems {
			view.Truncated = true
			break
		}
		address := fields[4]
		colon := strings.LastIndexByte(address, ':')
		if colon < 0 {
			return view, errors.New("监听地址格式无效")
		}
		port, err := strconv.Atoi(address[colon+1:])
		if err != nil || port < 1 || port > 65535 {
			return view, errors.New("监听端口格式无效")
		}
		item := LinuxPort{Protocol: fields[0], State: fields[1], Address: address, Host: strings.Trim(address[:colon], "[]"), Port: port, PIDs: []int{}, Process: strings.Join(fields[6:], " ")}
		seen := map[int]bool{}
		for _, match := range socketPID.FindAllStringSubmatch(item.Process, 64) {
			pid, err := strconv.Atoi(match[1])
			if err != nil {
				return view, err
			}
			if !seen[pid] {
				item.PIDs = append(item.PIDs, pid)
				seen[pid] = true
			}
		}
		view.Items = append(view.Items, item)
	}
	return view, nil
}

func (a *AppService) ProbeNetworkTCP(ctx context.Context, workspace, source, host string, port int) (float64, error) {
	if host == "" || len(host) > 255 || strings.ContainsAny(host, "\x00\r\n /\\") || port < 1 || port > 65535 || (source != "local" && source != "remote") {
		return 0, errors.New("TCP 探测来源、主机或端口无效")
	}
	a.mu.Lock()
	owner := a.workspaces[workspace]
	if owner == nil || a.closed {
		a.mu.Unlock()
		return 0, errors.New("SSH 工作区已关闭")
	}
	if a.commandSlots == nil {
		a.commandSlots = make(chan struct{}, 4)
	}
	slots := a.commandSlots
	a.mu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	stop := context.AfterFunc(owner.ctx, cancel)
	defer stop()
	select {
	case slots <- struct{}{}:
	case <-ctx.Done():
		return 0, ctx.Err()
	}
	defer func() { <-slots }()
	address := net.JoinHostPort(host, strconv.Itoa(port))
	if source == "remote" {
		elapsed, err := owner.terminal.MeasureTargetTCP(ctx, address)
		return float64(elapsed.Microseconds()) / 1000, err
	}
	started := time.Now()
	conn, err := (&net.Dialer{}).DialContext(ctx, "tcp", address)
	if err != nil {
		return 0, err
	}
	conn.Close()
	return float64(time.Since(started).Microseconds()) / 1000, ctx.Err()
}
