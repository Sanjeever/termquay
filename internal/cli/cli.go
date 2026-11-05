package cli

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/Sanjeever/termquay/internal/localapi"
)

func Run(ctx context.Context, args []string, version string, in io.Reader, out, stderr io.Writer) int {
	jsonMode := false
	for _, arg := range args {
		if arg == "--json" || arg == "--json=true" {
			jsonMode = true
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
	if op == "connection" || op == "workspace" {
		if len(rest) == 0 {
			return help([]string{op}, out)
		}
		if rest[0] == "--help" || rest[0] == "-h" {
			return help([]string{op}, out)
		}
		if rest[0] != "list" {
			return fail("未知子命令，请使用 termquay " + op + " --help")
		}
		op += ".list"
		rest = rest[1:]
	}
	if op != "status" && op != "connection.list" && op != "workspace.list" && op != "exec" {
		return fail("未知命令，请使用 termquay --help")
	}
	fs := flag.NewFlagSet(op, flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	fs.BoolVar(&jsonMode, "json", jsonMode, "JSON 输出")
	fs.Bool("no-input", false, "非交互；所有命令均不提示输入")
	r := localapi.Request{Operation: op}
	var command, file string
	var timeout time.Duration
	if op == "connection.list" {
		fs.StringVar(&r.ProtocolFilter, "protocol", "", "协议")
		fs.StringVar(&r.Group, "group", "", "精确分组 ID")
		fs.StringVar(&r.Search, "search", "", "名称、主机或用户关键词")
	}
	if op == "exec" {
		fs.StringVar(&r.Workspace, "workspace", "", "精确工作区 ID")
		fs.StringVar(&command, "command", "", "脚本正文")
		fs.StringVar(&file, "script-file", "", "脚本文件或 -")
		fs.DurationVar(&timeout, "timeout", 30*time.Second, "超时")
	}
	if err := fs.Parse(rest); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return help([]string{op}, out)
		}
		return fail(err.Error())
	}
	if fs.NArg() != 0 {
		return fail("不接受位置参数；脚本通过 --command 或 --script-file 提供")
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
