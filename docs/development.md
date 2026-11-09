# Development and usage

[简体中文](development.zh-CN.md) · [Contributing](../CONTRIBUTING.md) · [Architecture](architecture.md)

This guide covers an independent contribution from checkout to verification. The [Chinese guide](development.zh-CN.md) retains the longer operational manual and historical acceptance records. Those records have not been rerun merely by translating this entry point. Commands below run from the repository root.

<a id="环境与定义入口"></a>
## Environment

- Use the Go language/toolchain in [go.mod](../go.mod). Keep the Wails CLI aligned with its module version.
- Use the matching pnpm declarations in [package.json](../package.json) and [frontend/package.json](../frontend/package.json), the checked-in [frontend lockfile](../frontend/pnpm-lock.yaml), and a Node version compatible with pnpm/Vite. [CI](../.github/workflows/ci.yml) defines the build matrix; actual verification environments are recorded in the [verification ledger](#verification-and-known-gaps).
- Native prerequisites differ by platform: macOS Command Line Tools, Windows WebView2, and a C compiler plus the appropriate GTK/WebKit development libraries on Linux. CI lists Ubuntu packages. Cross-compilation does not verify a native WebView.
- Keep toolchain changes project-local. Do not change global package manager configuration, dependency mirrors or another project's tools.

[Taskfile.yml](../Taskfile.yml), [build/config.yml](../build/config.yml) and [platform tasks](../build) define ports, resources and build flags. Template server/Docker/iOS tasks do not imply supported product deployment modes: this is a desktop application.

Use `WAILS_VITE_PORT` for a custom development port. The RDP bridge derives its exact loopback origin allowlist from Wails' `FRONTEND_DEVSERVER_URL`; custom launchers must keep it consistent with the real frontend server. Do not permit arbitrary origins to bypass a setup error.

<a id="首次运行"></a>
## First run

Build frontend assets before compiling or testing the root Go package:

```sh
pnpm --dir frontend install --frozen-lockfile
pnpm --dir frontend build
```

Start desktop development with the same command on Windows, macOS and Linux:

```sh
pnpm dev
```

The [launcher](../scripts/wails.mjs) installs the CLI version selected by `go.mod` into the ignored `.tools` directory when missing or mismatched. It adds that directory to PATH for Wails and its child tasks. New terminals need no PATH setup. The root package has no dependencies and needs no separate install; frontend dependencies stay in `frontend`.

Development tasks generate bindings and start the desktop and Vite server. Browser previews do not verify the native Wails runtime.

### Development commands

The root [package.json](../package.json) provides these entry points. Keep its pnpm declaration aligned with [frontend/package.json](../frontend/package.json).

| Command | Action |
| --- | --- |
| `pnpm dev` | Run `wails3 task dev`, using the project's development config and port |
| `pnpm build` | Run `wails3 build` |
| `pnpm package` | Run `wails3 task package` for the host platform |
| `pnpm wails:doctor` | Run `wails3 doctor` (`pnpm doctor` is pnpm's own command) |
| `pnpm bindings` | Run `wails3 generate bindings -ts -i` |
| `pnpm task <task> [args]` | Run a Wails task |
| `pnpm wails <command> [args]` | Run any Wails CLI command |
| `pnpm dev:frontend` | Start Vite without the desktop |
| `pnpm build:frontend` | Type-check and build frontend assets |
| `pnpm check` | Run the frontend TypeScript check |
| `pnpm test` | Run the existing frontend and script tests |

Arguments are passed through, for example `pnpm build ARCH=arm64` or `pnpm task darwin:package:universal`. Packaging prerequisites still come from the [platform tasks](../build); builds can update Go modules and generated bindings, so inspect the resulting diff. The `frontend` package's `dev` script remains the Vite entry point used by Wails.

<a id="日常修改与验证"></a>
## Changes and checks

After Go service/model/event changes, regenerate bindings and inspect the result:

```sh
pnpm bindings
pnpm --dir frontend test
pnpm --dir frontend check
pnpm --dir frontend build
```

Do not edit [generated bindings](../frontend/bindings) manually. Choose backend checks proportional to the change:

```sh
go test ./internal/...
go test ./...
```

The second command includes the root entry point and needs built frontend assets. On a supported platform with CGO and a C compiler, run the relevant race checks, for example `go test -race ./internal/...`. Ordinary tests do not substitute for race detection. Documentation-only changes need content/link/diff checks, not builds.

Frontend tests use [Vitest](../frontend/vitest.config.ts). Pure logic runs in Node; React component tests run in jsdom with React Testing Library and user-event. [Script tests](../scripts/test.mjs) retain Node's built-in `node:test`. Both `pnpm test` and `pnpm --dir frontend test` run the script and frontend suites and fail if either fails. CI uses the same entry point, also builds on three platforms, checks binding consistency and runs the [CLI smoke check](../scripts/cli-smoke.mjs). A workflow definition is not evidence that a check ran for your change.

## Interface localization

Resources live in [frontend/src/i18n/locales](../frontend/src/i18n/locales), grouped by feature, and ship offline with the application. English is the fallback. Maintain both languages, semantic keys, whole sentences, interpolation parameters and appropriate plurals. `pnpm --dir frontend test` checks resource consistency.

Language extends [appearance settings](../frontend/src/features/settings/appearance.ts) and the existing portable UI/backup path. Legacy missing preferences default to following the system. Supported English and Simplified Chinese preferences are matched in order; unsupported locales fall back to English without claiming Traditional Chinese support. Store `auto` itself and resolve it again on the destination device.

Initialize before storage unlock. Keep HeroUI, HTML language, CodeMirror phrases, xterm accessibility labels, formatting, sorting and Go-owned native UI synchronized. The Vite locale-context alias makes HeroUI providers and overlays share one React Aria context; verify it when dependencies change.

Translate at display boundaries. [Diagnostic metadata](../internal/message) has no language state or translation engine. Preserve original diagnostics, error chains, file recovery codes, SSH steps and machine fields. Legacy machine state values remain intact with additive display codes. Unknown diagnostics and remote output remain inspectable.

Language changes must not alter workspace keys, recreate editors, reconnect sessions, cancel transfers or replay operations. Reconfigure editor phrases/presentation while retaining content, selection and undo history. Keep error objects/metadata in transient state so open notices can update. Do not translate user names, commands, paths, terminal output, remote file/log bodies, model-generated content or original licenses. Published release notes retain their original language.

<a id="使用说明"></a>
<a id="连接与工作区"></a>
<a id="ssh-工作区与本地终端"></a>
<a id="远端文件与传输"></a>
<a id="文件编辑"></a>
<a id="远程桌面"></a>
<a id="linux-监控与日志查看"></a>
<a id="文件预览"></a>
<a id="设置与演示模式"></a>
<a id="终端工具与命令片段"></a>
<a id="本地草稿与布局恢复"></a>
<a id="备份与恢复"></a>
<a id="内置-ai-助手"></a>
## Using the workbench

- **Connections:** the fixed connection center manages groups, filters and saved metadata. Environment, tags and saved filters are under **Filters**; active conditions remain visible and **Clear filters** also resets the protocol. The catalog footer shows the result count and selection actions. Outer tabs hold connection workspaces or independent multi-host/log/Docker tools; SSH inner tabs hold terminals/files. The workspace switcher stays outside the scrolling tab strip, and duplicate file names show distinguishing parent paths. Quick connect parses supported addresses/options for review and does not execute the entered text.
- **Identity and credentials:** verify new fingerprints/certificates against a trusted source. Changed identities block connection. Review legitimate changes in identity settings. Shared credential updates require reviewing the affected connection set.
- **Storage and lock:** explicitly choose master password/session storage if the system keychain is unavailable. Connection metadata is not whole-database encrypted. Application lock blocks new interaction while existing sessions/tasks can continue. Forgotten passwords require an independent backup.
- **Files:** enable file browsing mode to block new file writes in that SSH workspace. It does not restrict terminal/task commands or cancel operations already started. Upload is in the file panel's options menu; bookmarks and paste use named icon buttons. Saving checks the remote baseline and preserves drafts on conflict. The editor toolbar shows save state; encoding and line endings are in its status bar. Reload, download and manual completion are in editor options. Recovery actions follow the failed operation, and draft-download errors remain separate from remote save errors. Encoding, history recovery, sudo authorization, validation and reload are separate decisions.
- **Transfers:** preview conflicts and selected differences. The panel groups tasks by batch, actual target and direction; finished entries can be expanded while running and failed entries stay visible. Resume and staging cleanup have separate confirmation flows. Resume explicitly after reconnecting to the same verified destination. Directory sync does not delete extra destination files. Cancellation does not prove remote termination.
- **Terminal tools:** snippets await explicit insertion; completion integration is enabled per shell session. Multi-host steps use separate shells. Review the first-host confirmation before continuing. Saved run results are locally encrypted and excluded from regular backups.
- **Monitoring/logs:** Linux collection uses existing tools and current-user permissions. Preserve unknown, stale, truncated and partial states. [Docker containers](#docker-containers) use a dedicated tool tab over an SSH-forwarded Unix socket.
- **AI:** questions, explicitly attached references and tool-read contents go to the configured model service. Review command approvals. Stopping, locking or disconnecting invalidates pending approvals; operations already sent may still have unknown remote state.
- **RDP:** embedded RDP currently uses TLS 1.2; TLS 1.3-only targets are unsupported. Clipboard is opt-in per session. The Windows system client owns its authentication/identity UI and does not report remote connection success to the app.
- **Language/demo:** choose **Settings → Appearance → Language**. Demo mode uses isolated in-memory data while real workspaces remain mounted. Demo results do not prove remote behavior.
- **Backups:** encryption passwords are separate from WebDAV login passwords. Explicitly include credentials when needed. Full replacement removes the local credential set even when the snapshot has none. Restored tunnel auto-start is paused; reselect local private key files and verify sync paths.

AI turns continue beyond a fixed tool-call count while their runtime budget allows. Near budget exhaustion or after repeated identical tool failures, the assistant stops tools and requests a text-only summary within the remaining budget. Review the results before sending a new question. Summary failure is reported; stopping, locking or disconnecting cancels it. Batch parsing limits, output/context/history bounds and individual command approvals still apply. See [AI ownership and budgets](architecture.md#ai-ownership-and-approvals).

### Docker containers

Open **Tools → Docker**, **SSH session actions → Docker containers**, or the **Docker container workspace** command. The tool selects the current SSH workspace when opened from it and reads containers automatically. Resize the container list, filter by name/image/project or state, and use **Overview**, **Logs**, **Terminal**, and **Mounts and ports**. Compose labels group existing containers; this is not Compose deployment, image management, or Kubernetes support.

The SSH server must allow Unix socket forwarding and the login user must already have socket permissions. **Connection settings** applies a custom/rootless socket explicitly. Saved SSH connections retain it in local [connection preferences](../internal/store/preferences.go); temporary connection changes apply to the current selection. Connection preferences are ordinary local settings, not credential storage. No Docker TCP listener, remote dependency installation, or automatic elevation is needed.

Logs load when their page opens and share the bounded log viewer, filtering Worker, copy and scroll controls. **Follow** rereads a recent window and does not guarantee a complete archive. **Add to multi-source logs** keeps the actual SSH instance, socket and container ID. Hidden/minimized/locked pages stop log reads and resource sampling. Switching tool tabs preserves selection and read content; disconnect preserves cached content without automatically binding to a new SSH instance.

Container terminals remain mounted when selecting other containers or hosts and can be reached from the open-terminal menu. Closing a terminal, the Docker tab, or its SSH workspace releases its channel; it does not prove the container process terminated. Confirm the SSH target, container name, full ID and action before start/stop/restart. A completed operation followed by a failed state refresh is reported separately. Mount actions open host directories; port actions create SSH-workspace-owned local tunnels, which remain manageable after closing Docker. Runtime limits remain in the [Docker client](../internal/docker/client.go) and [workspace service](../internal/app/docker.go).

The English guide covers core usage and contribution paths. The long-form [Chinese operational manual](development.zh-CN.md#使用说明) has not yet been fully translated.

<a id="本机-cli"></a>
## Local CLI

Enable **Settings → Local CLI**, unlock the desktop, then discover exact live SSH workspaces:

```sh
termquay --version
termquay --help
termquay status --json --no-input
termquay connection list --json --no-input
termquay workspace list --json --no-input
termquay file list --workspace '<exact-workspace-id>' --path /tmp --json --no-input
termquay file read --workspace '<exact-workspace-id>' --path '<absolute-text-file-path>' --json --no-input
termquay service inspect --workspace '<exact-workspace-id>' --unit '<full-name.service>' --json --no-input
termquay port list --workspace '<exact-workspace-id>' --json --no-input
termquay container list --workspace '<exact-workspace-id>' --json --no-input
termquay task list --json --no-input
termquay run list --json --no-input
termquay run show --id '<exact-run-id>' --json --no-input
termquay exec --workspace '<exact-workspace-id>' --script-file '<local-script-path>' --timeout 30s --json --no-input
```

Use the installed program's help as the command contract; repository definitions are in [CLI help](../internal/cli/help.go) and the [IPC protocol](../internal/localapi/protocol.go). On macOS it is inside `.app/Contents/MacOS/termquay`; Windows retains `.exe` and callers must wait and collect its exit code. IPC supports the same OS user/environment, not a container/WSL/remote-development proxy.

Before business commands, check the status response has no `error`, `data.running=true`, `data.compatible=true`, `data.enabled=true` and `data.locked=false`. Status remains readable with exit code zero when CLI access is disabled or the application is locked; process success alone does not establish authorization. Handle setup/unlock in the desktop.

Saved connections are metadata, not evidence that a host is online. Workspaces identify backend SSH owners, not every frontend tab. Match `id`, `connection_id`, `target` and `state`; never execute against a fuzzy name.

File/service/port/container queries retain permissions, encoding, version, warnings and truncation. They do not start services, containers or tasks. Definitions/results may contain sensitive text. Run pagination uses `next_offset`, `has_more` and, on subsequent live pages, the first page's `summary.revision` as `--revision`. Restart pagination on `record_changed`.

Container queries take their own `--socket` argument; omitting it uses the default in [CLI help](../internal/cli/help.go), independently of the Docker tool's saved connection preference. For rootless Docker, pass the intended socket explicitly. AI container tools likewise take a separate `socket` argument in their [tool definitions](../internal/app/ai_tools.go).

Exec uses a separate non-PTY `sh -s` session without the interactive terminal's directory/environment. Prefer `--script-file` or stdin for multiline scripts. Check the process exit code, response-level `error.remote_state_unknown`, and `data.result.exit_code`, `error` and `truncated`. Decode bounded `stdout_base64`/`stderr_base64` on text decoding failure; do not replay a command to fix display. Cancellation/timeout/disconnect does not prove remote termination. The [Agent skill](../skills/termquay/SKILL.md) does not install the app or authorize arbitrary remote operations.

<a id="真实-ssh-与-webdav"></a>
## Optional real services

Community contributions do not require maintainer servers. Unit tests/local protocol services work without SSH/WebDAV credentials. Do not access someone else's server or add credentials merely to avoid a skipped test.

Real tests opt in through securely injected process settings. Never put real values in Git, screenshots or shell history:

| Suite | Configuration |
| --- | --- |
| `TestSG1*` password entry | `SSH_MCP_SERVER_SG1_HOST`, `SSH_MCP_SERVER_SG1_PORT`, `SSH_MCP_SERVER_SG1_USERNAME`, `SSH_MCP_SERVER_SG1_PASSWORD`, `TERMQUAY_TEST_HOST_FINGERPRINT` |
| [`TestSG1Workflow*`](../internal/app/ssh_workflow_integration_test.go) | Host, port, username and verified fingerprint above, plus `TERMQUAY_TEST_PRIVATE_KEY_PATH` pointing to an unencrypted test private key; no password required |
| [`TestRealWebDAV`](../internal/backup/webdav_test.go) | `TERMQUAY_WEBDAV_URL`, `TERMQUAY_WEBDAV_USERNAME`, `TERMQUAY_WEBDAV_PASSWORD`, `TERMQUAY_WEBDAV_DIRECTORY` for an existing isolated writable collection; creates and cleans a unique child collection |

Independently verify the target fingerprint. File tests create and clean their own `/tmp/termquay-*` directories. Do not change system/SSH/services/business files or install remote tools. Some workflow cases require existing sudo/tmux/Docker permissions. Follow [remote-operation boundaries](../AGENTS.md#credentials-and-remote-operations).

```sh
go test -count=1 -v ./internal/app ./internal/ssh ./internal/files ./internal/monitor -run '^TestSG1'
go test -count=1 -v -timeout=10m ./internal/app -run '^TestSG1Workflow'
go test -v ./internal/backup -run '^TestRealWebDAV$'
go test -v ./internal/app -run '^TestSavedConnectionFileEditing$'
```

The workflow-only command is an alternative to the full SSH selection. Use `-race` where supported. The [saved-connection file test](../internal/app/files_integration_test.go) uses `TERMQUAY_TEST_SAVED_CONNECTION`, `TERMQUAY_TEST_HOST_FINGERPRINT` and the system vault; it does not implement master-password unlock. Read the test before using it. Configured real-service tests also run under ordinary `go test` package selections; missing settings cause skips, which must be reported separately from passes.

<a id="已有验收记录与缺口"></a>
<a id="重连修复与验证缺口"></a>
<a id="内置-ai-验收2026-11-06"></a>
<a id="windows-ssh-ai-适配验收2026-11-09"></a>
## Verification and known gaps

Report unit tests, local protocol integration, browser substitutes, native desktop, real SSH, real RDP and real WebDAV separately. A browser substitute, local SSH fixture or cross-build cannot establish native/real-remote acceptance.

Historical evidence and unresolved gaps remain in the [Chinese acceptance ledger](development.zh-CN.md#已有验收记录与缺口), including [AI acceptance](development.zh-CN.md#内置-ai-验收2026-11-06) and [Windows SSH AI adaptation](development.zh-CN.md#windows-ssh-ai-适配验收2026-11-09). Platform input/IME, RDP clipboard/concurrency, native menus/dialogs, real multi-hop reconnect, provider behavior and sustained application-wide resource measurements need environment-specific evidence. Do not present historical results as current checks.

### Workbench UI verification (2026-11-09)

UI changes through `edd70a0` were checked on macOS / arm64 with Node 26.11.0, pnpm 11.20.0 and Chromium 156.0.8078.80. `pnpm test` passed 77 tests, including recovery action selection, duplicate file labels, complete workspace-switcher results and POSIX/Windows transfer grouping. The TypeScript check and production frontend build passed.

Browser checks used the actual React views with isolated demo data or temporary Wails request/stream substitutes. Coverage included protocol/environment/search filters and clearing empty results; save state, line-ending edits and undo; retained editor DOM/content on language changes; 200-pixel file navigation; distinguishing duplicate file tabs; and a fixed switcher with 20 workspaces and arrow-key selection. Monitoring/AI switching and narrow/wide transitions retained the AI input element and its unsent draft. Transfer checks covered batch summaries, collapsed finished entries, visible running/failed entries, separate resume/cleanup confirmations and the corresponding action arguments. Injected save conflicts, encoding failures and local download failures verified targeted recovery and preservation of both draft and error context. Light/dark themes and 760×650, 900×650 and 1280×820 viewports were inspected; the checked narrow layouts had no page overflow.

These checks do not establish native WebView input, native zoom, OS clipboard/dialog behavior, real SSH/RDP/WebDAV behavior or sustained resource performance. No remote server operations were performed for this UI change.

### Docker workspace verification (2026-11-09)

Docker runtime changes through `0d0dac4` were checked on Windows 11 build 26100 / amd64, Go 1.26.10, Node 22.17.0 and local pnpm 12.16.1. The declared toolchain and lockfile were unchanged. `pnpm --dir frontend test` passed all 72 tests, the TypeScript check and production build passed, and `go test ./internal/docker ./internal/store ./internal/app` passed. Bindings were regenerated for the socket preference API. Preference regression coverage checks connection isolation, preservation across unrelated preference writes, reset and invalid/non-SSH targets.

Browser substitutes exercised automatic container reads, filtering and empty results, socket save arguments, container switching, filtered logs and forwarding a log source, confirmation before mutation with exact host/socket/container arguments, successful mutation followed by refresh failure, stale detail response rejection, stopping hidden-page polling, disconnect cache retention and disabled actions, terminal DOM retention across selection/language changes, and a 760×650 layout without horizontal overflow. The actual workbench tools menu, tool tab selection/keyboard navigation and closing were also exercised. The settings update at `d91510c` passed a TypeScript check and browser inspection confirming all 11 navigation icons have distinct SVG paths.

The shell selector follow-up at `a8d11d0` passed the TypeScript check and a browser check selecting `/bin/bash`, verifying that exact argument in the terminal creation request and observing no missing-option warnings.

Wails responses and container terminal creation were synthetic in the browser. No real Docker/SSH connection, native WebView, native terminal stream, macOS/Linux UI, or sustained resource measurement was verified for this change. Backend package tests and browser state checks do not establish those scenarios.

### Localization verification (2026-11-09)

Runtime changes through `3d19d0f` were checked on Windows 11 build 26100 / amd64, Go 1.26.10, Node 22.17.0 and WebView2 157.0.4341.42. Dependency installation used the declared pnpm 11.20.0; later validation commands used the locally available pnpm 12.16.1 without changing the manifest or lockfile policy.

| Layer | Actual coverage | Limits |
| --- | --- | --- |
| Automated | 72 frontend tests, including an English-host-language run; TypeScript check and production build; `go test ./...` with 304 test cases passing and 24 skipped; `go vet ./internal/...`; regenerated bindings unchanged on repeat | Skips include missing real-service settings and Windows/POSIX-only fixtures. `-race` could not start because CGO is disabled; no C compiler was available. |
| Browser substitutes | English first-storage setup, password unlock failure, retained error translation, settings in both languages, component dismiss/select accessibility labels, 900×600 layout without horizontal overflow, editor DOM/content/undo continuity | Wails responses were substitutes; this does not establish remote or native integration. |
| Windows native WebView | Production frontend with temporary Go overlays isolating app data, WebView profile and CLI pipe; real password-vault failure/success, application lock failure/success, English retained across process restart, demo editor identity/content/caret/undo and open search query retained on language change | Demo editor content is in memory. The overlay used a disposable test password and did not read saved connections or credentials. |
| Windows native file dialog | Recording picker title was `Open terminal recording`, confirmed using Windows UI Automation, then canceled | Operating-system-owned controls use the OS language. macOS menu updates and other platform dialogs were not exercised. |

No real SSH, RDP, WebDAV or model-provider verification was performed for this change. Language switching during live remote transfers/tasks, other native WebViews, IME/screen readers and sustained application-wide resource behavior remain unverified. Backend error/identity/conflict/restore/cancellation regression tests and stable owner/effect dependencies provide separate evidence; they do not replace those real scenarios. Test processes were closed and their data stayed outside the repository. A [Chinese summary](development.zh-CN.md#中英文界面验收2026-11-09) links to this record.

<a id="构建与本地打包"></a>
## Build and local packaging

```sh
pnpm build
pnpm package
```

Builds go to `bin/`. Consult [platform tasks](../build): macOS packaging uses local ad-hoc signing; Windows NSIS needs `makensis`; MSIX/Linux formats need their tools. These documented workflows do not authorize publishing or signed distribution. Full tasks can run `go mod tidy` and regenerate bindings; inspect the diff and preserve build customizations. The [Chinese resource guide](development.zh-CN.md#构建与本地打包) retains detailed icon procedures.

<a id="版本与发布"></a>
<a id="应用检查与安装更新"></a>
## Versions and releases

[frontend/package.json](../frontend/package.json) is the application version source; [scripts/version.mjs](../scripts/version.mjs) synchronizes platform resources. Database, backup and layout versions evolve independently.

Before an authorized future bump, write `docs/releases/<version>.md`, English first and Chinese second in the same file, and commit it with version resources. Preserve published logs/public versions. Language/contribution work does not authorize a bump, tag, push, release or signed distribution.

Candidate artifacts/checksums and publishing are defined in [the release workflow](../.github/workflows/release.yml). Native candidate acceptance and [third-party audit gaps](../THIRD_PARTY_NOTICES.md) must be addressed before an authorized public release. Checksums prove integrity; signing/authenticity is separate.
