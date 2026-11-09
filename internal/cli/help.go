package cli

import (
	"fmt"
	"io"
	"strings"
)

func help(path []string, out io.Writer) int {
	topic := strings.Join(path, ".")
	fmt.Fprintln(out, `TermQuay local CLI
Usage: termquay <command> [options]
No arguments opens the desktop. --version prints the local version. Use help or --help at any level.
Business commands require the desktop running as the same OS user, with Settings > Local CLI enabled and the app unlocked.
No dialogs, credential prompts or trust confirmation. --no-input explicitly declares noninteractive use without changing permissions.
All business commands support --json. Results go to stdout; diagnostics go to stderr.
JSON: {protocol:1,data?:...,error?:{code,message,remote_state_unknown}}.
Exit codes: 0 success, 1 business/transport/remote failure, 2 invalid arguments. Remote exit status is in the exec result.
Protocol and application versions are independent; use the same distribution if they are incompatible.`)
	switch topic {
	case "":
		fmt.Fprintln(out, `Commands:
  status [--json]                         Instance, authorization, lock and compatibility
  connection list [--protocol ssh] [--group <id>] [--search <text>] [--json]
  workspace list [--json]                 Backend-observable SSH workspaces
  file list|read --workspace <id> --path <absolute-path> [--json]
  service list|inspect|logs --workspace <id> [--unit <full-unit-name>] [--json]
  port list --workspace <id> [--json]
  container list|inspect|logs --workspace <id> [--id <full-container-id>] [--json]
  task list|show [--id <task-id>] [--json]
  run list|show [--id <run-id>] [--json]
  exec --workspace <id> --command <script> [--timeout 30s] [--json] [--no-input]
Examples: termquay workspace list --json --no-input
          termquay exec --workspace <exact-id> --command 'uname -a' --json --no-input`)
	case "status":
		fmt.Fprintln(out, "Usage: termquay status [--json] [--no-input]\nWithout a desktop, returns running=false and unavailable with exit code 1. Minimal status is readable with exit code 0 when disabled/locked; check data.enabled and data.locked before business commands. Locked status does not disclose enabled authorization and returns enabled=false.")
	case "connection", "connection.list":
		fmt.Fprintln(out, "Usage: termquay connection list [--protocol ssh] [--group <exact-id>] [--search <text>] [--json] [--no-input]\nLists saved connection metadata without network probes or credentials. Group matching is exact, without recursion.")
	case "workspace", "workspace.list":
		fmt.Fprintln(out, "Usage: termquay workspace list [--json] [--no-input]\nLists Go-owned SSH workspaces with actual targets/state, not every frontend tab. Temporary connections have an empty connection_id. Execute using an exact workspace ID, never a fuzzy name.")
	case "file", "file.list", "file.read":
		fmt.Fprintln(out, `Usage: termquay file list --workspace <exact-id> --path <absolute-remote-path> [--json] [--no-input]
       termquay file read --workspace <exact-id> --path <absolute-remote-path> [--encoding UTF-8] [--json] [--no-input]
Directory queries reuse the bounded paired-browser scan and return up to 512 entries. Check truncated; this may be an incomplete directory.
Text reads reuse the online editor boundary: regular files within 2 MiB; use resolved target paths for symbolic links.
Supports UTF-8, GBK/ANSI, GB2312 and GB18030; returns body, version, encoding, BOM and line endings.
Reads do not save drafts/history or upload files. Encoded JSON responses over 4 MiB fail with response_too_large.`)
	case "service", "service.list", "service.inspect", "service.logs":
		fmt.Fprintln(out, `Usage: termquay service list --workspace <exact-id> [--search <service-or-wildcard>] [--json] [--no-input]
       termquay service inspect --workspace <exact-id> --unit <full-name.service> [--json] [--no-input]
       termquay service logs --workspace <exact-id> --unit <full-name.service> [--json] [--no-input]
Queries systemd with the current remote user's permissions, without service changes or elevation. Missing tools/permissions return real errors.
list returns loaded services, read time and truncation; inspect returns the actual target and properties.
logs returns recent output and truncation. Restricted journal access is not a complete system log.`)
	case "port", "port.list":
		fmt.Fprintln(out, `Usage: termquay port list --workspace <exact-id> [--json] [--no-input]
Queries TCP/UDP listeners and process ownership visible to the current user; requires existing remote iproute2 ss.
Does not create tunnels or probe ports. Check read time, warning and truncation.`)
	case "container", "container.list", "container.inspect", "container.logs":
		fmt.Fprintln(out, `Usage: termquay container list --workspace <exact-id> [--socket <unix-path>] [--json] [--no-input]
       termquay container inspect --workspace <exact-id> --id <full-container-id> [--socket <unix-path>] [--json] [--no-input]
       termquay container logs --workspace <exact-id> --id <full-container-id> [--socket <unix-path>] [--json] [--no-input]
Default socket: /var/run/docker.sock; explicitly choose a rootless path when needed. Uses Docker HTTP API over SSH.
Requires existing socket permissions; no Docker CLI, elevation or container state changes. Use full IDs returned by list.
Lists states, Compose groups and ports; details include mounts, health and exits; logs return a recent window and truncated.`)
	case "task", "task.list", "task.show":
		fmt.Fprintln(out, `Usage: termquay task list [--search <name>] [--json] [--no-input]
       termquay task show --id <exact-task-id> [--json] [--no-input]
list returns saved task id, name and step_count; show returns full definitions including commands/checks.
Reading local tasks requires no SSH workspace and does not start, modify or delete tasks. Definitions may contain sensitive text.`)
	case "run", "run.list", "run.show":
		fmt.Fprintln(out, `Usage: termquay run list [--search <name>] [--json] [--no-input]
       termquay run show --id <exact-run-id> [--offset 0] [--limit 8] [--revision <revision>] [--json] [--no-input]
list combines current and explicitly saved runs; show returns summary, task on page one, and paged results.
offset: 0 to 1024; limit: 1 to 64, default 8. Response byte limits may return fewer results.
Follow next_offset; has_more=false ends pagination. Retain exit codes, verdicts and output truncation.
Live records change. Pass the first page's summary.revision on later pages; record_changed requires restarting at page one.
Reads do not start, cancel, continue, replay or persist previously unsaved tasks/results.`)
	case "exec":
		fmt.Fprintln(out, `Usage: termquay exec --workspace <exact-id> <script-source> [--timeout 30s] [--json] [--no-input]
Choose one source: --command <script> | --script-file <path> | --script-file - (stdin)
Script: 1 to 32768 bytes without NUL. Timeout: whole seconds from 1s to 600s, default 30s.
Example: termquay exec --workspace <exact-id> --script-file ./inspect.sh --timeout 60s --json --no-input
Reuses connected SSH through a separate sh -s session without PTY or the interactive shell's directory/environment.
Commands may modify remote systems. Result data={workspace,result:{stdout,stderr,exit_code,duration_ms,truncated,error}}.
Output is UTF-8. On decoding failure result.error reports it; stdout_base64/stderr_base64 retain corresponding raw bytes.
Response errors are in error; check error.remote_state_unknown. Result errors are in data.result.error.
stdout limit: 64 KiB; stderr: 16 KiB. exit_code=-1 means unknown; nonzero exits use remote_exit.
Ctrl-C, client disconnect, workspace close and desktop exit cancel requests. Cancellation/timeout does not prove remote termination.
Disabling access or locking blocks new requests; admitted requests retain their deadlines. Never automatically retry unknown-state commands.`)
	default:
		fmt.Fprintln(out, "Unknown help topic")
		return 2
	}
	return 0
}
