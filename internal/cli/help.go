package cli

import (
	"fmt"
	"io"
	"strings"
)

func help(path []string, out io.Writer) int {
	topic := strings.Join(path, ".")
	fmt.Fprintln(out, `TermQuay 本机 CLI
用法：termquay <命令> [选项]
无参数启动桌面。--version 输出本机版本。help 或各级 --help 查看帮助。
业务命令需要同一操作系统用户运行桌面，在设置 → 本机 CLI 启用访问并解锁。
不弹窗、不询问凭据或信任。--no-input 显式声明非交互；不会改变权限。
所有业务命令支持 --json。stdout 输出结果，诊断写入 stderr。
JSON：{protocol:1,data?:...,error?:{code,message,remote_state_unknown}}。
退出码：0 成功，1 业务/传输/远端失败，2 参数错误。远端退出码见 exec 结果。
协议版本独立于产品版本；协议不兼容请使用同一发行包。`)
	switch topic {
	case "":
		fmt.Fprintln(out, `命令：
  status [--json]                         实例、授权、锁与兼容状态
  connection list [--protocol ssh] [--group <id>] [--search <text>] [--json]
  workspace list [--json]                 后端可观测的 SSH 工作区
  exec --workspace <id> --command <script> [--timeout 30s] [--json] [--no-input]
示例：termquay workspace list --json --no-input
      termquay exec --workspace <精确ID> --command 'uname -a' --json --no-input`)
	case "status":
		fmt.Fprintln(out, "用法：termquay status [--json] [--no-input]\n桌面未运行时返回 running=false 和 unavailable，退出码 1。禁用或锁定仍可读取最小状态。锁定时 enabled 不披露，返回 false。")
	case "connection", "connection.list":
		fmt.Fprintln(out, "用法：termquay connection list [--protocol ssh] [--group <精确ID>] [--search <关键词>] [--json] [--no-input]\n列出保存连接元数据，不探测网络，不返回凭据。分组筛选精确匹配，不递归。")
	case "workspace", "workspace.list":
		fmt.Fprintln(out, "用法：termquay workspace list [--json] [--no-input]\n列出后端持有的 SSH 工作区，含实际目标和状态；不代表全部前端标签。临时连接的 connection_id 为空。使用工作区精确 ID 执行，禁止模糊选择。")
	case "exec":
		fmt.Fprintln(out, `用法：termquay exec --workspace <精确ID> <脚本来源> [--timeout 30s] [--json] [--no-input]
脚本来源三选一：--command <script> | --script-file <path> | --script-file -（stdin）
脚本 1–32768 字节，无 NUL；超时为 1s–600s 整秒，默认 30s。
示例：termquay exec --workspace <精确ID> --script-file ./inspect.sh --timeout 60s --json --no-input
复用已连接 SSH，通过独立 session 执行 sh -s，无 PTY，不继承交互 Shell 目录与环境。
命令可能修改远端。结果 data={workspace,result:{stdout,stderr,exit_code,duration_ms,truncated,error}}。
stdout 上限 64 KiB，stderr 16 KiB；exit_code=-1 表示未知，非零退出以 remote_exit 区分。
Ctrl-C、客户端断开、工作区关闭和桌面退出取消请求。取消或超时不证明远端进程退出。
关闭授权或应用锁定阻止新请求，已获准请求继续受原超时约束。状态未知时不自动重试。`)
	default:
		fmt.Fprintln(out, "未知帮助主题")
		return 2
	}
	return 0
}
