package cli

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path"
	"strings"
	"time"

	"github.com/Sanjeever/termquay/internal/localapi"
)

func Run(ctx context.Context, args []string, version string, in io.Reader, out, stderr io.Writer) int {
	jsonMode := false
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--json" || arg == "--json=true" {
			jsonMode = true
		}
		switch arg {
		case "--command", "--script-file", "--workspace", "--timeout", "--protocol", "--group", "--search", "--path", "--encoding", "--unit", "--socket", "--id", "--offset", "--limit", "--revision":
			i++
		}
	}
	fail := func(message string) int {
		return output(localapi.Failure("usage", message, false), jsonMode, out, stderr, 2)
	}
	if len(args) == 1 && args[0] == "--version" {
		fmt.Fprintln(out, version)
		return 0
	}
	if len(args) == 0 {
		return fail("缺少命令")
	}
	if args[0] == "help" {
		return help(args[1:], out)
	}
	if args[0] == "--help" || args[0] == "-h" {
		return help(nil, out)
	}
	op := args[0]
	rest := args[1:]
	switch op {
	case "connection", "workspace", "file", "service", "port", "container", "task", "run":
		if len(rest) == 0 {
			return help([]string{op}, out)
		}
		if rest[0] == "--help" || rest[0] == "-h" {
			return help([]string{op}, out)
		}
		op += "." + rest[0]
		rest = rest[1:]
	}
	switch op {
	case "status", "connection.list", "workspace.list", "exec", "file.list", "file.read", "service.list", "service.inspect", "service.logs", "port.list", "container.list", "container.inspect", "container.logs", "task.list", "task.show", "run.list", "run.show":
	default:
		return fail("未知命令，请使用 termquay --help")
	}
	fs := flag.NewFlagSet(op, flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	fs.BoolVar(&jsonMode, "json", jsonMode, "JSON 输出")
	fs.Bool("no-input", false, "非交互；所有命令均不提示输入")
	r := localapi.Request{Operation: op}
	needsWorkspace := op == "exec" || strings.HasPrefix(op, "file.") || strings.HasPrefix(op, "service.") || strings.HasPrefix(op, "port.") || strings.HasPrefix(op, "container.")
	if needsWorkspace {
		fs.StringVar(&r.Workspace, "workspace", "", "精确工作区 ID")
	}
	var command, file string
	var timeout time.Duration
	if op == "connection.list" {
		fs.StringVar(&r.ProtocolFilter, "protocol", "", "协议")
		fs.StringVar(&r.Group, "group", "", "精确分组 ID")
		fs.StringVar(&r.Search, "search", "", "名称、主机或用户关键词")
	}
	if op == "exec" {
		fs.StringVar(&command, "command", "", "脚本正文")
		fs.StringVar(&file, "script-file", "", "脚本文件或 -")
		fs.DurationVar(&timeout, "timeout", 30*time.Second, "超时")
	}
	switch op {
	case "file.list", "file.read":
		fs.StringVar(&r.Path, "path", "", "远端绝对路径")
		if op == "file.read" {
			fs.StringVar(&r.Encoding, "encoding", "UTF-8", "文本编码")
		}
	case "service.list", "task.list", "run.list":
		fs.StringVar(&r.Search, "search", "", "名称筛选；服务支持通配符")
	case "service.inspect", "service.logs":
		fs.StringVar(&r.Unit, "unit", "", "完整服务单元名称")
	case "task.show", "run.show":
		fs.StringVar(&r.ID, "id", "", "精确任务或执行记录 ID")
	}
	if strings.HasPrefix(op, "container.") {
		fs.StringVar(&r.Socket, "socket", "/var/run/docker.sock", "远端 Docker Unix socket")
		if op != "container.list" {
			fs.StringVar(&r.ID, "id", "", "完整容器 ID")
		}
	}
	if op == "run.show" {
		fs.IntVar(&r.Offset, "offset", 0, "结果起始位置")
		fs.IntVar(&r.Limit, "limit", 8, "最多返回结果数（1 至 64）")
		fs.Uint64Var(&r.Revision, "revision", 0, "核对记录修订；0 不核对")
	}
	if err := fs.Parse(rest); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return help([]string{op}, out)
		}
		return fail(err.Error())
	}
	if fs.NArg() != 0 {
		return fail("不接受位置参数，请通过命令选项提供参数")
	}
	if needsWorkspace && r.Workspace == "" {
		return fail("必须提供 --workspace 精确工作区 ID")
	}
	if strings.HasPrefix(op, "file.") && (!path.IsAbs(r.Path) || len(r.Path) > 4096 || strings.ContainsRune(r.Path, 0)) {
		return fail("--path 须为远端绝对路径，不能含 NUL，最多 4096 字节")
	}
	if (op == "service.inspect" || op == "service.logs") && r.Unit == "" {
		return fail("必须提供 --unit 完整服务单元名称")
	}
	if (op == "container.inspect" || op == "container.logs" || op == "task.show" || op == "run.show") && r.ID == "" {
		return fail("必须提供 --id 精确标识")
	}
	if op == "run.show" && (r.Offset < 0 || r.Offset > 1024 || r.Limit < 1 || r.Limit > 64) {
		return fail("--offset 须为 0 至 1024，--limit 须为 1 至 64")
	}
	if op == "exec" {
		seen := map[string]bool{}
		fs.Visit(func(f *flag.Flag) { seen[f.Name] = true })
		if r.Workspace == "" || seen["command"] == seen["script-file"] {
			return fail("必须提供 --workspace，并在 --command 与 --script-file 中选择一个")
		}
		if timeout < time.Second || timeout > 600*time.Second || timeout%time.Second != 0 {
			return fail("--timeout 须为 1s 至 600s 的整秒时长")
		}
		r.TimeoutSeconds = int(timeout / time.Second)
		if seen["script-file"] {
			reader := in
			if file != "-" {
				f, err := os.Open(file)
				if err != nil {
					return fail(err.Error())
				}
				defer f.Close()
				reader = f
			}
			data, err := io.ReadAll(io.LimitReader(reader, localapi.MaxScript+1))
			if err != nil {
				return fail(err.Error())
			}
			command = string(data)
		}
		if len(command) == 0 || len(command) > localapi.MaxScript || strings.ContainsRune(command, 0) {
			return fail("脚本须为 1 至 32768 字节且不能含 NUL")
		}
		r.Script = command
	}
	response := localapi.Call(ctx, r)
	if op == "status" && response.Error != nil && response.Error.Code == "unavailable" {
		response.Data = json.RawMessage(`{"running":false,"enabled":false,"locked":false,"compatible":false,"version":""}`)
	}
	return output(response, jsonMode, out, stderr, 1)
}

func output(response localapi.Response, jsonMode bool, out, stderr io.Writer, errorExit int) int {
	if jsonMode {
		if err := json.NewEncoder(out).Encode(response); err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
	} else {
		if len(response.Data) > 0 {
			var execution struct {
				Result *struct {
					Stdout    string `json:"stdout"`
					Stderr    string `json:"stderr"`
					Truncated bool   `json:"truncated"`
				} `json:"result"`
			}
			if json.Unmarshal(response.Data, &execution) == nil && execution.Result != nil {
				fmt.Fprint(out, execution.Result.Stdout)
				fmt.Fprint(stderr, execution.Result.Stderr)
				if execution.Result.Truncated {
					fmt.Fprintln(stderr, "输出已截断，请使用 --json 查看结果标记")
				}
			} else {
				var value any
				json.Unmarshal(response.Data, &value)
				encoder := json.NewEncoder(out)
				encoder.SetIndent("", "  ")
				if err := encoder.Encode(value); err != nil {
					fmt.Fprintln(stderr, err)
					return 1
				}
			}
		}
		if response.Error != nil {
			fmt.Fprintln(stderr, response.Error.Code+": "+response.Error.Message)
			if response.Error.RemoteStateUnknown {
				fmt.Fprintln(stderr, "远端状态未知；请核对后再操作，不要自动重放")
			}
		}
	}
	if response.Error != nil {
		return errorExit
	}
	return 0
}
