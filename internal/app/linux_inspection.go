package app

import (
	"context"
	"encoding/json"
	"errors"

	"io"
	"strconv"
	"strings"
	"time"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
)

const maxInspectionItems = 512

type LinuxProcess struct {
	PID     int     `json:"pid"`
	Parent  int     `json:"parent"`
	User    string  `json:"user"`
	CPU     float64 `json:"cpu"`
	Memory  float64 `json:"memory"`
	RSS     int64   `json:"rss"`
	Elapsed string  `json:"elapsed"`
	Command string  `json:"command"`
}

type LinuxProcessList struct {
	Items     []LinuxProcess `json:"items"`
	Time      time.Time      `json:"time"`
	Truncated bool           `json:"truncated"`
	Warning   string         `json:"warning"`
}

type LinuxProcessDetails struct {
	Directory  string   `json:"directory"`
	Executable string   `json:"executable"`
	Service    string   `json:"service"`
	Errors     []string `json:"errors"`
}

type LinuxService struct {
	Unit        string `json:"unit"`
	Load        string `json:"load"`
	Active      string `json:"active"`
	Sub         string `json:"sub"`
	Description string `json:"description"`
}

type LinuxServiceList struct {
	Items     []LinuxService `json:"items"`
	Time      time.Time      `json:"time"`
	Truncated bool           `json:"truncated"`
	Warning   string         `json:"warning"`
}

type LinuxServiceDetails struct {
	Target     string            `json:"target"`
	Properties map[string]string `json:"properties"`
	Warning    string            `json:"warning"`
}

func (a *AppService) inspectLinux(ctx context.Context, workspace, script string) (terminal.CommandResult, error) {
	result, err := a.RunRemoteCommand(ctx, workspace, "set -eu\ntest \"$(uname -s)\" = Linux || { printf '%s\\n' '诊断支持 Linux' >&2; exit 2; }\nexport LC_ALL=C SYSTEMD_COLORS=0\n"+script, 15)
	if err != nil {
		return result, err
	}
	if result.Error != "" {
		return result, errors.New(result.Error)
	}
	if result.ExitCode != 0 {
		return result, appmessage.Errorf("backend:remoteQueryFailedExitCode", "远端查询失败（退出码 %d）：%s", result.ExitCode, strings.TrimSpace(result.Stderr))
	}
	return result, nil
}

func (a *AppService) ListLinuxProcesses(ctx context.Context, workspace, order string) (LinuxProcessList, error) {
	column := "-pcpu"
	if order == "memory" {
		column = "-rss"
	} else if order != "cpu" {
		return LinuxProcessList{}, appmessage.New("backend:invalidProcessSorting", "进程排序无效")
	}
	result, err := a.inspectLinux(ctx, workspace, "exec ps -ww -eo pid=,ppid=,user:32=,pcpu=,pmem=,rss=,etime=,args= --sort="+column)
	view := LinuxProcessList{Items: []LinuxProcess{}, Time: time.Now(), Truncated: result.Truncated, Warning: strings.TrimSpace(result.Stderr)}
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
		if len(fields) < 8 {
			return view, appmessage.New("backend:invalidProcessListFormatProcpsPsIsRequired", "进程列表格式无效，需要 procps ps")
		}
		if len(view.Items) == maxInspectionItems {
			view.Truncated = true
			break
		}
		pid, pidErr := strconv.Atoi(fields[0])
		parent, parentErr := strconv.Atoi(fields[1])
		cpu, cpuErr := strconv.ParseFloat(fields[3], 64)
		memory, memoryErr := strconv.ParseFloat(fields[4], 64)
		rss, rssErr := strconv.ParseInt(fields[5], 10, 64)
		if err := errors.Join(pidErr, parentErr, cpuErr, memoryErr, rssErr); err != nil {
			return view, appmessage.Errorf("backend:invalidProcessMetricsFormat", "进程指标格式无效：%w", err)
		}
		view.Items = append(view.Items, LinuxProcess{PID: pid, Parent: parent, User: fields[2], CPU: cpu, Memory: memory, RSS: rss * 1024, Elapsed: fields[6], Command: strings.Join(fields[7:], " ")})
	}
	return view, nil
}

func (a *AppService) ReadLinuxProcessDetails(ctx context.Context, workspace string, pid int) (LinuxProcessDetails, error) {
	view := LinuxProcessDetails{Errors: []string{}}
	if pid < 1 || pid > 1<<31-1 {
		return view, appmessage.New("backend:invalidProcessID", "进程 ID 无效")
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	client, release, err := a.fileClient(ctx, workspace)
	if err != nil {
		return view, err
	}
	defer release()
	root := "/proc/" + strconv.Itoa(pid)
	if _, err := client.Lstat(root); err != nil {
		return view, appmessage.Errorf("backend:couldNotReadProcessItMayHaveExited", "读取进程失败，进程可能已退出：%w", err)
	}
	view.Directory, err = client.ReadLink(root + "/cwd")
	if err != nil {
		view.Errors = append(view.Errors, "工作目录："+err.Error())
	}
	view.Executable, err = client.ReadLink(root + "/exe")
	if err != nil {
		view.Errors = append(view.Errors, "可执行文件："+err.Error())
	}
	file, err := client.Open(root + "/cgroup")
	if err != nil {
		view.Errors = append(view.Errors, "所属服务："+err.Error())
		return view, nil
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, (16<<10)+1))
	if err != nil {
		view.Errors = append(view.Errors, "所属服务："+err.Error())
	} else if len(data) > 16<<10 {
		view.Errors = append(view.Errors, "所属服务：cgroup 内容超过读取限制")
	} else {
		for line := range strings.SplitSeq(string(data), "\n") {
			parts := strings.SplitN(line, ":", 3)
			if len(parts) != 3 {
				continue
			}
			for _, part := range strings.Split(parts[2], "/") {
				if validServiceUnit(part) && !strings.Contains(parts[2], "/user.slice/") {
					view.Service = part
				}
			}
		}
	}
	return view, nil
}

func (a *AppService) ListLinuxServices(ctx context.Context, workspace, filter string) (LinuxServiceList, error) {
	if len(filter) > 256 || strings.ContainsAny(filter, "'\"\x00\r\n/") {
		return LinuxServiceList{}, appmessage.New("backend:serviceFilterMustBeANameOrWildcard", "服务筛选须为服务名称或通配符")
	}
	pattern := "*.service"
	if filter != "" {
		pattern = "*" + filter + "*"
	}
	result, err := a.inspectLinux(ctx, workspace, "exec systemctl --no-pager --no-ask-password --all --type=service --output=json list-units -- '"+pattern+"'")
	view := LinuxServiceList{Items: []LinuxService{}, Time: time.Now(), Warning: strings.TrimSpace(result.Stderr)}
	if err != nil {
		return view, err
	}
	if result.Truncated {
		return view, appmessage.New("backend:serviceListExceedsOutputLimitEnterAService", "服务列表超过输出限制，请填写服务名后刷新")
	}
	if err := json.Unmarshal([]byte(result.Stdout), &view.Items); err != nil {
		return view, appmessage.Errorf("backend:invalidServiceListFormatSystemctlWithListUnits", "服务列表格式无效，需要支持 list-units JSON 输出的 systemctl：%w", err)
	}
	for _, item := range view.Items {
		if !validServiceUnit(item.Unit) || item.Load == "" || item.Active == "" || item.Sub == "" {
			return view, appmessage.New("backend:serviceListHasNoValidNameOrState", "服务列表缺少有效名称或状态")
		}
	}
	if len(view.Items) > maxInspectionItems {
		view.Items = view.Items[:maxInspectionItems]
		view.Truncated = true
	}
	return view, nil
}

func validServiceUnit(unit string) bool {
	return unit != ".service" && strings.HasSuffix(unit, ".service") && len(unit) <= 256 && !strings.HasPrefix(unit, "-") && !strings.ContainsAny(unit, "'\"\x00\r\n/ *?[]")
}

func (a *AppService) ReadLinuxServiceDetails(ctx context.Context, workspace, unit string) (LinuxServiceDetails, error) {
	view := LinuxServiceDetails{Properties: map[string]string{}}
	if !validServiceUnit(unit) {
		return view, appmessage.New("backend:invalidServiceName", "服务名称无效")
	}
	a.mu.Lock()
	if owner := a.workspaces[workspace]; owner != nil {
		view.Target = owner.target
	}
	a.mu.Unlock()
	result, err := a.inspectLinux(ctx, workspace, "exec systemctl --no-pager --no-ask-password show --all --property=Id,Description,LoadState,ActiveState,SubState,MainPID,ExecMainStartTimestamp,ExecMainStatus,FragmentPath,User,WorkingDirectory,Result,UnitFileState,CanReload -- '"+unit+"'")
	if err != nil {
		return view, err
	}
	if result.Truncated {
		return view, appmessage.New("backend:serviceDetailsExceedReadLimit", "服务详情超过读取限制")
	}
	view.Warning = strings.TrimSpace(result.Stderr)
	for line := range strings.SplitSeq(result.Stdout, "\n") {
		if key, value, ok := strings.Cut(line, "="); ok {
			view.Properties[key] = value
		}
	}
	if view.Properties["Id"] == "" || view.Properties["LoadState"] == "" || view.Properties["LoadState"] == "not-found" || view.Properties["ActiveState"] == "" {
		return view, appmessage.New("backend:serviceMissingOrUnreadable", "服务不存在或无法读取")
	}
	return view, nil
}

func (a *AppService) ChangeLinuxServiceState(ctx context.Context, workspace, unit, action string) (terminal.CommandResult, error) {
	if !validServiceUnit(unit) {
		return terminal.CommandResult{}, appmessage.New("backend:invalidServiceName", "服务名称无效")
	}
	switch action {
	case "start", "stop", "restart", "reload", "enable", "disable":
	default:
		return terminal.CommandResult{}, appmessage.New("backend:invalidServiceOperation", "服务操作无效")
	}
	return a.RunRemoteCommand(ctx, workspace, "export LC_ALL=C SYSTEMD_COLORS=0\nexec systemctl --no-pager --no-ask-password "+action+" -- '"+unit+"'", 60)
}

func (a *AppService) ReadLinuxServiceLog(ctx context.Context, workspace, unit string) (terminal.CommandResult, error) {
	if !validServiceUnit(unit) {
		return terminal.CommandResult{}, appmessage.New("backend:invalidServiceName", "服务名称无效")
	}
	return a.inspectLinux(ctx, workspace, "exec journalctl --no-pager --lines=200 --output=short-iso --unit='"+unit+"'")
}
