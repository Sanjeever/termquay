package docker

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"

	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	"github.com/moby/moby/api/pkg/stdcopy"
)

type Port struct {
	IP          string `json:"ip"`
	PrivatePort uint16 `json:"private_port"`
	PublicPort  uint16 `json:"public_port"`
	Type        string `json:"type"`
}
type Container struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Image   string `json:"image"`
	State   string `json:"state"`
	Status  string `json:"status"`
	Project string `json:"project"`
	Ports   []Port `json:"ports"`
}
type Mount struct {
	Type        string `json:"type"`
	Source      string `json:"source"`
	Destination string `json:"destination"`
	Writable    bool   `json:"writable"`
}
type Details struct {
	Mounts       []Mount                `json:"mounts"`
	TTY          bool                   `json:"tty"`
	Health       string                 `json:"health"`
	HealthLog    string                 `json:"health_log"`
	ExitCode     int                    `json:"exit_code"`
	OOMKilled    bool                   `json:"oom_killed"`
	Error        string                 `json:"error"`
	ErrorMessage *appmessage.Descriptor `json:"error_message,omitempty"`
	FinishedAt   string                 `json:"finished_at"`
	RestartCount int                    `json:"restart_count"`
}
type Logs struct {
	Text      string `json:"text"`
	Truncated bool   `json:"truncated"`
}
type Client struct {
	http      *http.Client
	transport *http.Transport
	prefix    string
}

func New(dial func(context.Context) (net.Conn, error)) *Client {
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) { return dial(ctx) }, DisableKeepAlives: true, MaxConnsPerHost: 2, ResponseHeaderTimeout: 15 * time.Second, MaxResponseHeaderBytes: 64 << 10}
	return &Client{http: &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, transport: transport}
}
func (c *Client) Close() { c.transport.CloseIdleConnections() }

func (c *Client) request(ctx context.Context, method, endpoint string, value any, upgrade bool) (*http.Response, error) {
	var body io.Reader
	if value != nil {
		data, err := json.Marshal(value)
		if err != nil {
			return nil, err
		}
		body = bytes.NewReader(data)
	}
	request, err := http.NewRequestWithContext(ctx, method, "http://docker"+c.prefix+endpoint, body)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	if upgrade {
		request.Header.Set("Connection", "Upgrade")
		request.Header.Set("Upgrade", "tcp")
	}
	response, err := c.http.Do(request)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		if upgrade && response.StatusCode == http.StatusSwitchingProtocols {
			return response, nil
		}
		defer response.Body.Close()
		data, err := io.ReadAll(io.LimitReader(response.Body, 4097))
		if err != nil {
			return nil, err
		}
		return nil, fmt.Errorf("Docker API %s: %s", response.Status, strings.ToValidUTF8(string(data), "�"))
	}
	return response, nil
}
func (c *Client) json(ctx context.Context, method, endpoint string, input, output any) error {
	r, err := c.request(ctx, method, endpoint, input, false)
	if err != nil {
		return err
	}
	defer r.Body.Close()
	data, err := io.ReadAll(io.LimitReader(r.Body, (4<<20)+1))
	if err != nil {
		return err
	}
	if len(data) > 4<<20 {
		return appmessage.New("backend:dockerAPIResponseExceeds4MiB", "Docker API 响应超过 4 MiB")
	}
	if output == nil {
		return nil
	}
	return json.Unmarshal(data, output)
}

func (c *Client) Negotiate(ctx context.Context) error {
	var version struct {
		APIVersion    string
		MinAPIVersion string
	}
	if err := c.json(ctx, "GET", "/version", nil, &version); err != nil {
		return err
	}
	minor, err := strconv.Atoi(strings.TrimPrefix(version.APIVersion, "1."))
	if err != nil || !strings.HasPrefix(version.APIVersion, "1.") || minor < 41 {
		return appmessage.New("backend:dockerAPIVersionInvalidOrBelow141", "Docker API 版本无效或低于 1.41")
	}
	minor = min(minor, 47)
	if version.MinAPIVersion != "" {
		minimum, err := strconv.Atoi(strings.TrimPrefix(version.MinAPIVersion, "1."))
		if err != nil || !strings.HasPrefix(version.MinAPIVersion, "1.") || minor < minimum {
			return appmessage.New("backend:dockerMinimumAPIVersionExceedsThisClientS", "Docker 最低 API 版本高于当前客户端支持范围")
		}
	}
	c.prefix = fmt.Sprintf("/v1.%d", minor)
	return nil
}

func (c *Client) List(ctx context.Context) ([]Container, error) {
	var raw []struct {
		ID                   string
		Names                []string
		Image, State, Status string
		Labels               map[string]string
		Ports                []struct {
			IP                      string
			PrivatePort, PublicPort uint16
			Type                    string
		}
	}
	if err := c.json(ctx, "GET", "/containers/json?all=1&limit=513", nil, &raw); err != nil {
		return nil, err
	}
	if len(raw) > 512 {
		return nil, appmessage.New("backend:containerCountExceeds512NarrowTheDockerInstance", "容器列表超过 512 项，请缩小 Docker 实例范围")
	}
	result := make([]Container, 0, len(raw))
	for _, item := range raw {
		if !validID(item.ID) || len(item.Ports) > 256 {
			return nil, appmessage.New("backend:invalidContainerIdentifierOrTooManyPorts", "容器标识无效或端口过多")
		}
		name := item.ID[:12]
		if len(item.Names) > 0 {
			name = strings.TrimPrefix(item.Names[0], "/")
		}
		container := Container{ID: item.ID, Name: name, Image: item.Image, State: item.State, Status: item.Status, Project: item.Labels["com.docker.compose.project"], Ports: []Port{}}
		for _, port := range item.Ports {
			container.Ports = append(container.Ports, Port{port.IP, port.PrivatePort, port.PublicPort, port.Type})
		}
		result = append(result, container)
	}
	return result, nil
}
func validID(id string) bool { return len(id) == 64 && strings.Trim(id, "0123456789abcdef") == "" }
func (c *Client) Inspect(ctx context.Context, id string) (Details, error) {
	if !validID(id) {
		return Details{}, appmessage.New("backend:invalidContainerID", "容器 ID 无效")
	}
	var raw struct {
		Config       struct{ Tty bool }
		RestartCount int
		State        struct {
			ExitCode          int
			OOMKilled         bool
			Error, FinishedAt string
			Health            *struct {
				Status string
				Log    []struct{ Output string }
			}
		}
		Mounts []struct {
			Type, Source, Destination string
			RW                        bool
		}
	}
	if err := c.json(ctx, "GET", "/containers/"+id+"/json", nil, &raw); err != nil {
		return Details{}, err
	}
	if len(raw.Mounts) > 256 {
		return Details{}, appmessage.New("backend:mountCountExceeds256", "挂载超过 256 项")
	}
	result := Details{TTY: raw.Config.Tty, Mounts: []Mount{}}
	result.ExitCode = raw.State.ExitCode
	result.OOMKilled = raw.State.OOMKilled
	result.Error = raw.State.Error
	result.FinishedAt = raw.State.FinishedAt
	result.RestartCount = raw.RestartCount
	if raw.State.Health != nil {
		result.Health = raw.State.Health.Status
		for _, entry := range raw.State.Health.Log[max(0, len(raw.State.Health.Log)-5):] {
			output := entry.Output
			if len(output) > 4096 {
				output = output[:4096] + "\n[健康检查输出已截断]"
			}
			result.HealthLog += strings.ToValidUTF8(output, "�") + "\n"
		}
	}
	for _, mount := range raw.Mounts {
		result.Mounts = append(result.Mounts, Mount{mount.Type, mount.Source, mount.Destination, mount.RW})
	}
	return result, nil
}
func (c *Client) Logs(ctx context.Context, id string) (Logs, error) {
	details, err := c.Inspect(ctx, id)
	if err != nil {
		return Logs{}, err
	}
	r, err := c.request(ctx, "GET", "/containers/"+id+"/logs?stdout=1&stderr=1&timestamps=1&tail=500", nil, false)
	if err != nil {
		return Logs{}, err
	}
	defer r.Body.Close()
	const limit = 256 << 10
	data, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil {
		return Logs{}, err
	}
	truncated := len(data) > limit
	if truncated {
		data = data[:limit]
	}
	if !details.TTY {
		end := 0
		for end < len(data) {
			if len(data)-end < 8 {
				truncated = true
				break
			}
			size := int(binary.BigEndian.Uint32(data[end+4 : end+8]))
			if size > limit {
				return Logs{}, appmessage.New("backend:dockerLogFrameExceeds256KiB", "Docker 日志单帧超过 256 KiB")
			}
			if size > len(data)-end-8 {
				truncated = true
				break
			}
			end += 8 + size
		}
		var output bytes.Buffer
		if _, err = stdcopy.StdCopy(&output, &output, bytes.NewReader(data[:end])); err != nil {
			return Logs{}, err
		}
		data = output.Bytes()
	}
	return Logs{Text: strings.ToValidUTF8(string(data), "�"), Truncated: truncated}, nil
}
func (c *Client) OpenConsole(ctx context.Context, id, shell string) (string, io.ReadWriteCloser, error) {
	if !validID(id) || (shell != "/bin/sh" && shell != "/bin/bash") {
		return "", nil, appmessage.New("backend:invalidContainerOrShell", "容器或 Shell 无效")
	}
	var exec struct{ ID string }
	options := map[string]any{"AttachStdin": true, "AttachStdout": true, "AttachStderr": true, "Tty": true, "Cmd": []string{shell}, "Env": []string{"TERM=xterm-256color"}}
	if err := c.json(ctx, "POST", "/containers/"+id+"/exec", options, &exec); err != nil {
		return "", nil, err
	}
	if !validID(exec.ID) {
		return "", nil, appmessage.New("backend:invalidDockerExecID", "Docker exec ID 无效")
	}
	r, err := c.request(ctx, "POST", "/exec/"+exec.ID+"/start", map[string]bool{"Detach": false, "Tty": true}, true)
	if err != nil {
		return "", nil, err
	}
	stream, ok := r.Body.(io.ReadWriteCloser)
	if r.StatusCode != http.StatusSwitchingProtocols || !ok {
		r.Body.Close()
		return "", nil, appmessage.New("backend:dockerDidNotUpgradeTheBidirectionalTerminalChannel", "Docker 未升级双向终端通道")
	}
	return exec.ID, stream, nil
}
func (c *Client) Resize(ctx context.Context, execID string, cols, rows int) error {
	if !validID(execID) || cols < 1 || cols > 1000 || rows < 1 || rows > 1000 {
		return appmessage.New("backend:invalidContainerTerminalDimensions", "容器终端尺寸无效")
	}
	query := url.Values{"w": {strconv.Itoa(cols)}, "h": {strconv.Itoa(rows)}}
	return c.json(ctx, "POST", "/exec/"+execID+"/resize?"+query.Encode(), nil, nil)
}
