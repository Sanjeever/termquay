package app

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	terminal "github.com/Sanjeever/termquay/internal/ssh"
)

func powerShellLiteral(value string) string { return "'" + strings.ReplaceAll(value, "'", "''") + "'" }

func windowsAIQuery(name string, args aiToolArguments, environment terminal.RemoteEnvironment) (string, error) {
	if len(args.Unit) > 256 || strings.ContainsAny(args.Unit, "\x00\r\n") || len(args.Search) > 256 || strings.ContainsAny(args.Search, "\x00\r\n") {
		return "", appmessage.New("backend:invalidServiceNameOrFilter", "服务名称或筛选无效")
	}
	service := `$services=@(Get-CimInstance -ClassName Win32_Service);`
	switch name {
	case "service_list":
		return service + `$search=` + powerShellLiteral(args.Search) + `; $items=@($services | Where-Object {$_.Name.IndexOf($search,[StringComparison]::OrdinalIgnoreCase) -ge 0 -or $_.DisplayName.IndexOf($search,[StringComparison]::OrdinalIgnoreCase) -ge 0} | Sort-Object Name | Select-Object -First 513 | ForEach-Object {@{name=$_.Name;display_name=$_.DisplayName;state=$_.State;start_mode=$_.StartMode;pid=$_.ProcessId}});@{items=@($items | Select-Object -First 512);truncated=($items.Count -gt 512)} | ConvertTo-Json -Depth 4 -Compress`, nil
	case "service_inspect", "service_logs":
		if args.Unit == "" {
			return "", appmessage.New("backend:aWindowsServiceInternalNameIsRequired", "需要 Windows 服务内部名称")
		}
		prefix := service + `$name=` + powerShellLiteral(args.Unit) + `;$service=$services | Where-Object {$_.Name -eq $name} | Select-Object -First 1;if ($null -eq $service) {throw '服务不存在或无法读取'};`
		if name == "service_inspect" {
			return prefix + `@{name=$service.Name;display_name=$service.DisplayName;state=$service.State;start_mode=$service.StartMode;pid=$service.ProcessId;account=$service.StartName;path=$service.PathName;exit_code=$service.ExitCode} | ConvertTo-Json -Compress`, nil
		}
		return prefix + `$events=@();try {$events=@(Get-WinEvent -FilterHashtable @{LogName='System';ProviderName='Service Control Manager'} -MaxEvents 512 -ErrorAction Stop)} catch {if ($_.FullyQualifiedErrorId -notlike 'NoMatchingEventsFound*') {throw}};$items=@($events | Where-Object {$values=@($_.Properties | ForEach-Object {$_.Value});$values -contains $service.Name -or $values -contains $service.DisplayName} | Select-Object -First 100 | ForEach-Object {@{time=$_.TimeCreated.ToUniversalTime().ToString('o');id=$_.Id;level=$_.Level;message=$_.Message}});@{source='System/Service Control Manager';scanned=$events.Count;items=$items;truncated=($events.Count -eq 512 -or $items.Count -eq 100);scope='最近至多 512 条服务控制管理器事件中的匹配项；不包含完整应用日志'} | ConvertTo-Json -Depth 4 -Compress`, nil
	case "port_list":
		query := `$items=@();`
		if environment.TCP {
			query += `$items+=@(Get-NetTCPConnection | Where-Object {$_.State -eq 'Listen'} | ForEach-Object {@{protocol='tcp';state='listen';host=$_.LocalAddress;port=$_.LocalPort;pid=$_.OwningProcess}});`
		}
		if environment.UDP {
			query += `$items+=@(Get-NetUDPEndpoint | ForEach-Object {@{protocol='udp';state='bound';host=$_.LocalAddress;port=$_.LocalPort;pid=$_.OwningProcess}});`
		}
		return query + `@{items=@($items | Sort-Object { $_.protocol },{ $_.port },{ $_.host } | Select-Object -First 512);truncated=($items.Count -gt 512);tcp_available=$` + strconv.FormatBool(environment.TCP) + `;udp_available=$` + strconv.FormatBool(environment.UDP) + `} | ConvertTo-Json -Depth 4 -Compress`, nil
	}
	return "", appmessage.New("backend:unknownWindowsQuery", "未知 Windows 查询")
}

func (a *AppService) queryWindowsAI(ctx context.Context, workspace, name string, args aiToolArguments, environment terminal.RemoteEnvironment) (any, error) {
	script, err := windowsAIQuery(name, args, environment)
	if err != nil {
		return nil, err
	}
	result, err := a.runRemoteScript(ctx, workspace, script, 20, "powershell", "UTF-8")
	if err != nil {
		return nil, err
	}
	if result.Error != "" || result.ExitCode != 0 {
		detail := result.ErrorMessage
		if detail == nil {
			detail = &appmessage.Descriptor{Message: result.Error}
		}
		return result, &aiToolError{Code: "query_failed", Message: "Windows 查询失败：" + result.Error + strings.TrimSpace(result.Stderr), Detail: &appmessage.Descriptor{MessageCode: "backend:toolWindowsQueryFailed", Parameters: map[string]any{"value1": detail, "value2": strings.TrimSpace(result.Stderr)}}}
	}
	if result.Truncated {
		return nil, &aiToolError{Code: "result_too_large", Message: "Windows 查询超过执行输出预算，请缩小筛选范围", Detail: appmessage.Describe(appmessage.New("backend:toolWindowsOutputBudget", "Windows 查询超过执行输出预算，请缩小筛选范围"))}
	}
	var value map[string]any
	if err := json.Unmarshal([]byte(result.Stdout), &value); err != nil {
		return nil, errors.New("Windows 查询未返回有效 JSON：" + err.Error())
	}
	if name == "port_list" && (!environment.TCP || !environment.UDP) {
		value["truncated"] = true
		value["warning"] = "部分端口查询命令不可用，结果不完整"
	}
	return value, nil
}
