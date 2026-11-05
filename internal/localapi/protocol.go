package localapi

import "encoding/json"

const Protocol = 1
const MaxScript = 32 << 10
const MaxRequest = 256 << 10
const MaxResponse = 4 << 20

type Request struct {
	Protocol       int    `json:"protocol"`
	Operation      string `json:"operation"`
	ProtocolFilter string `json:"protocol_filter,omitempty"`
	Group          string `json:"group,omitempty"`
	Search         string `json:"search,omitempty"`
	Workspace      string `json:"workspace,omitempty"`
	Script         string `json:"script,omitempty"`
	TimeoutSeconds int    `json:"timeout_seconds,omitempty"`
}

type Error struct {
	Code               string `json:"code"`
	Message            string `json:"message"`
	RemoteStateUnknown bool   `json:"remote_state_unknown"`
}

type Response struct {
	Protocol int             `json:"protocol"`
	Data     json.RawMessage `json:"data,omitempty"`
	Error    *Error          `json:"error,omitempty"`
}

func Result(data any) Response {
	b, err := json.Marshal(data)
	if err != nil {
		return Failure("internal", err.Error(), false)
	}
	if len(b) > MaxResponse-1024 {
		return Failure("response_too_large", "结果超过 4 MiB，请缩小筛选范围", false)
	}
	return Response{Protocol: Protocol, Data: b}
}

func Failure(code, message string, unknown bool) Response {
	return Response{Protocol: Protocol, Error: &Error{Code: code, Message: message, RemoteStateUnknown: unknown}}
}

type Status struct {
	Running    bool   `json:"running"`
	Enabled    bool   `json:"enabled"`
	Locked     bool   `json:"locked"`
	Version    string `json:"version"`
	Compatible bool   `json:"compatible"`
}

type Connection struct {
	ID       string `json:"id"`
	GroupID  string `json:"group_id"`
	Name     string `json:"name"`
	Protocol string `json:"protocol"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username"`
}

type Workspace struct {
	ID           string `json:"id"`
	ConnectionID string `json:"connection_id"`
	Protocol     string `json:"protocol"`
	Target       string `json:"target"`
	State        string `json:"state"`
}
