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
  file list|read --workspace <id> --path <绝对路径> [--json]
  service list|inspect|logs --workspace <id> [--unit <完整单元名>] [--json]
  port list --workspace <id> [--json]
  container list|inspect|logs --workspace <id> [--id <完整容器ID>] [--json]
  task list|show [--id <任务ID>] [--json]
  run list|show [--id <执行记录ID>] [--json]
  exec --workspace <id> --command <script> [--timeout 30s] [--json] [--no-input]
示例：termquay workspace list --json --no-input
      termquay exec --workspace <精确ID> --command 'uname -a' --json --no-input`)
	case "status":
		fmt.Fprintln(out, "用法：termquay status [--json] [--no-input]\n桌面未运行时返回 running=false 和 unavailable，退出码 1。禁用或锁定仍可读取最小状态。锁定时 enabled 不披露，返回 false。")
	case "connection", "connection.list":
		fmt.Fprintln(out, "用法：termquay connection list [--protocol ssh] [--group <精确ID>] [--search <关键词>] [--json] [--no-input]\n列出保存连接元数据，不探测网络，不返回凭据。分组筛选精确匹配，不递归。")
	case "workspace", "workspace.list":
		fmt.Fprintln(out, "用法：termquay workspace list [--json] [--no-input]\n列出后端持有的 SSH 工作区，含实际目标和状态；不代表全部前端标签。临时连接的 connection_id 为空。使用工作区精确 ID 执行，禁止模糊选择。")
	case "file", "file.list", "file.read":
		fmt.Fprintln(out, `用法：termquay file list --workspace <精确ID> --path <远端绝对路径> [--json] [--no-input]
      termquay file read --workspace <精确ID> --path <远端绝对路径> [--encoding UTF-8] [--json] [--no-input]
目录复用成对浏览的分页扫描，最多返回 512 项；检查 truncated，不表示完整目录。
文本复用在线编辑读取，限 2 MiB 普通文件，符号链接须使用实际目标路径。
支持 UTF-8、GBK/ANSI、GB2312 与 GB18030；返回正文、版本、编码、BOM 和换行格式。
读取不保存草稿或历史，不上传文件。JSON 编码后的响应超过 4 MiB 时返回 response_too_large。`)
	case "service", "service.list", "service.inspect", "service.logs":
		fmt.Fprintln(out, `用法：termquay service list --workspace <精确ID> [--search <服务名或通配符>] [--json] [--no-input]
      termquay service inspect --workspace <精确ID> --unit <完整名称.service> [--json] [--no-input]
      termquay service logs --workspace <精确ID> --unit <完整名称.service> [--json] [--no-input]
使用远端当前用户权限查询 systemd，不启停服务、不提权。工具缺失或无权访问时返回真实错误。
list 返回已加载服务、读取时间与截断标记，inspect 返回实际目标和服务属性。
logs 返回近期日志与输出截断标记；journal 权限不足时不能视作完整系统日志。`)
	case "port", "port.list":
		fmt.Fprintln(out, `用法：termquay port list --workspace <精确ID> [--json] [--no-input]
查询 TCP/UDP 监听端口及当前用户可见的进程归属，需要远端已有 iproute2 ss。
不建立隧道、不发起端口探测。检查结果中的读取时间、warning 与截断标记。`)
	case "container", "container.list", "container.inspect", "container.logs":
		fmt.Fprintln(out, `用法：termquay container list --workspace <精确ID> [--socket <Unix路径>] [--json] [--no-input]
      termquay container inspect --workspace <精确ID> --id <完整容器ID> [--socket <Unix路径>] [--json] [--no-input]
      termquay container logs --workspace <精确ID> --id <完整容器ID> [--socket <Unix路径>] [--json] [--no-input]
默认 socket 为 /var/run/docker.sock，可明确指定 rootless 路径；经 SSH 访问 Docker HTTP API。
需要已有 socket 权限，不调用 Docker CLI、不提权、不启停容器。id 使用 list 返回的完整值。
列表包含容器状态、Compose 分组和端口，详情包含挂载、健康与退出信息；日志返回近期窗口及 truncated。`)
	case "task", "task.list", "task.show":
		fmt.Fprintln(out, `用法：termquay task list [--search <名称>] [--json] [--no-input]
      termquay task show --id <精确任务ID> [--json] [--no-input]
list 返回已保存任务的 id、name 与 step_count；show 返回完整定义，包括命令及判定条件。
读取本机任务不要求打开 SSH 工作区，不启动、修改或删除任务；定义可能包含敏感文本。`)
	case "run", "run.list", "run.show":
		fmt.Fprintln(out, `用法：termquay run list [--search <名称>] [--json] [--no-input]
      termquay run show --id <精确执行记录ID> [--offset 0] [--limit 8] [--revision <修订号>] [--json] [--no-input]
list 合并本次运行和显式保存的执行记录；show 返回 summary、首分页的 task 与 results 分页。
offset 为 0 至 1024，limit 为 1 至 64，默认 8；响应预算可能使实际返回数少于 limit。
使用 next_offset 读取后续页，has_more=false 表示结束。保留每项远端退出码、判定与输出截断标记。
运行中记录会变化；后续页带首分页 summary.revision，变化时返回 record_changed，需从第一页重读。
读取不启动、取消、继续或重放任务，也不将未保存结果持久化。`)
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
