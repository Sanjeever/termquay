# Development and usage

[简体中文](development.zh-CN.md) · [Contributing](../CONTRIBUTING.md) · [Architecture](architecture.md)

This guide covers an independent contribution from checkout to verification. The [Chinese guide](development.zh-CN.md) retains the longer operational manual and historical acceptance records. Those records have not been rerun merely by translating this entry point. Commands below run from the repository root.

<a id="环境与定义入口"></a>
## Environment

### Packaged desktop

The release archives contain the application, without requiring Go, Node, pnpm or a C compiler on the destination computer. Windows needs WebView2. Linux needs the runtime libraries declared in [package metadata](../build/linux/nfpm/nfpm.yaml); the [release workflow](../.github/workflows/release.yml) archives the executable without bundling those libraries. macOS bundle requirements are declared in [Info.plist](../build/darwin/Info.plist). Build runners and declared requirements do not establish acceptance on every OS version; see [verification and known gaps](#verification-and-known-gaps).

### Source development

- Use the Go language/toolchain in [go.mod](../go.mod). Keep the Wails CLI aligned with its module version.
- Use the matching pnpm declarations in [package.json](../package.json) and [frontend/package.json](../frontend/package.json), the checked-in [frontend lockfile](../frontend/pnpm-lock.yaml), and a Node version compatible with pnpm/Vite. [CI](../.github/workflows/ci.yml) defines the build matrix; actual verification environments are recorded in the [verification ledger](#verification-and-known-gaps).
- Source builds need platform tools: macOS Command Line Tools, the [Windows build tools](../build/windows/Taskfile.yml), and a C compiler plus the appropriate GTK/WebKit development libraries on Linux. [CI](../.github/workflows/ci.yml) lists Ubuntu development packages; runtime requirements are [above](#packaged-desktop). Cross-compilation does not verify a native WebView.
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
| `pnpm lint` | Run Oxlint and Go vet; build frontend assets first for the root Go package |
| `pnpm format` / `pnpm format:check` | Format handwritten frontend/scripts and Go source, or check without writing |
| `pnpm test:ui` | Run the Chromium layout and editor-state regressions |
| `pnpm verify` | Check formatting, run frontend lint/build, Go vet, script/frontend/Go tests and browser regressions |

Arguments are passed through, for example `pnpm build ARCH=arm64` or `pnpm task darwin:package:universal`. Packaging prerequisites still come from the [platform tasks](../build); builds can update Go modules and generated bindings, so inspect the resulting diff. The `frontend` package's `dev` script remains the Vite entry point used by Wails.

<a id="日常修改与验证"></a>
## Changes and checks

For behavior/API/error/configuration changes, follow the [documentation synchronization rules](../AGENTS.md#documentation-consistency). Check the implementation, direct callers and effective tests before updating claims; keep unresolved contract violations visible rather than documenting them as intended behavior.

After changes to exposed Go services/models/events, regenerate bindings and inspect the result:

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

CI has one quality job for formatting, Oxlint, TypeScript and Chromium regressions. The existing platform matrix runs the frontend/script suites, Go vet/tests, native builds, binding consistency and the [CLI smoke check](../scripts/cli-smoke.mjs); Linux also runs race detection. A workflow definition is not evidence that a check ran for your change.

### Linting and formatting

Oxlint and Oxfmt are pinned development dependencies in [frontend/package.json](../frontend/package.json). The root commands invoke the same configuration as the frontend package. [Oxlint configuration](../.oxlintrc.json) enables correctness checks and the core React Hooks rules, fails on warnings and reports unused suppressions. The React Compiler-specific rules listed there are disabled for this React application without compiler optimization. TypeScript checking remains `tsc --noEmit` with the existing [compiler settings](../frontend/tsconfig.json); type-aware Oxlint and a TypeScript migration are separate changes.

Inspect Effect dependency findings against the resource owner and cleanup path. Local lint exceptions explain which identity or explicit action owns an Effect; preserve those boundaries when changing dependencies. Terminal/editor recreation, repeated requests and clearing pending drafts are behavior changes. Follow the [lifecycle](architecture.md#communication-backpressure-and-lifecycle) and [language-switching](architecture.md#localization-and-collaboration) contracts.

[Oxfmt configuration](../.oxfmtrc.json) keeps existing import, Tailwind class and package-field order. Formatting covers handwritten frontend files, project scripts, package/tool configuration and the CI workflow; generated bindings, lockfiles, build outputs, third-party materials and historical documentation are excluded. The [Go formatter entry point](../scripts/go-format.mjs) checks root Go files and `internal/`; its check mode fails when gofmt reports differences. Keep a formatting migration separate from semantic fixes.

After installing frontend dependencies, install the browser selected by the pinned Playwright package once, then run the aggregate check from the repository root:

```sh
pnpm --dir frontend exec playwright install --no-shell chromium
pnpm verify
```

Linux hosts also need Playwright system libraries; CI installs them with `--with-deps`. `pnpm verify` builds embedded frontend assets before Go vet/tests. It does not run race detection or native packaging; choose those separately for affected behavior. `pnpm lint:frontend` and `pnpm lint:go` run the language-specific checks independently.

### Browser regressions

[Playwright configuration](../frontend/playwright.config.ts) defines the isolated loopback Vite server, Chromium selection and worker count. The [fixture](../frontend/e2e/fixture.tsx) mounts the actual titlebar, workspace tabs, appearance provider and CodeMirror editor with controlled state; [tests](../frontend/e2e/workbench.spec.ts) substitute Wails calls at the HTTP boundary. These development fixtures are outside the production entry point and Vitest projects.

The suite checks tab/action adjacency, overflow, mouse/keyboard access and editor instance/document/selection/undo preservation during language, theme and font changes. Platform variants exercise header styling in Chromium, not native Windows/Linux/macOS WebViews. Browser diagnostics are captured on failure and uploaded by CI. Keep native window dragging, input/IME, remote connections and protocol acceptance in their corresponding verification layers.

The [terminal browser fixture](../frontend/e2e/terminal.tsx) mounts the actual local-terminal view and xterm. Clipboard and stream boundaries are substituted to check single-use multiline-paste confirmation, bracketed input bytes and focus return. It does not establish native clipboard or PTY behavior.

### Frontend tests

Frontend tests use [Vitest](../frontend/vitest.config.ts), inheriting the application's Vite configuration, React transform and locale-context alias. Colocate pure logic tests as `*.test.ts` in the `unit` project (Node). Name component and Hook tests `*.test.tsx` in the `components` project (jsdom), using React Testing Library and user-event. Existing Node assertions remain valid. [Script tests](../scripts/test.mjs) retain Node's built-in `node:test`.

| Command | Scope |
| --- | --- |
| `pnpm test` or `pnpm --dir frontend test` | Run script and frontend tests once; stop with a nonzero exit code if either suite fails |
| `pnpm --dir frontend test:unit` | Run frontend pure logic tests |
| `pnpm --dir frontend test:components` | Run component and Hook tests |
| `pnpm --dir frontend test:components useFileDrafts` | Filter component tests by file name |
| `pnpm --dir frontend test:watch` | Watch frontend tests; optionally add `--project unit` or `--project components` |

The [DOM setup](../frontend/src/test/setup.ts) unmounts components, clears local storage and restores English after each test. Use accessible roles/names and user interactions to assert visible behavior. Keep deferred operations under test control, reset mocks between cases and restore any test-specific browser API substitutes. Mock generated Wails service calls and native events at their boundary; keep the component, Hook and state logic real. See [file drafts](../frontend/src/features/files/useFileDrafts.test.tsx), [close protection](../frontend/src/features/workspaces/WorkbenchCloseDialog.test.tsx), [connection forms](../frontend/src/features/connections/ConnectionDialog.test.tsx) and [language/editor state](../frontend/src/features/settings/AppearanceProvider.test.tsx) for examples.

jsdom tests do not verify browser layout, native WebView input, terminal/RDP rendering or real remote operations. The editor tests use actual CodeMirror state and history with substituted layout APIs; retain browser, native desktop and real-service checks for their respective behavior. Go tests remain separate from `pnpm test`.

## Interface localization

Resources live in [frontend/src/i18n/locales](../frontend/src/i18n/locales), grouped by feature, and ship offline with the application. English is the fallback. Maintain both languages, semantic keys, whole sentences, interpolation parameters and appropriate plurals. `pnpm --dir frontend test` checks resource consistency.

Language extends [appearance settings](../frontend/src/features/settings/appearance.ts) and the existing portable UI/backup path. Legacy missing preferences default to following the system. Supported English and Simplified Chinese preferences are matched in order; unsupported locales fall back to English without claiming Traditional Chinese support. Store `auto` itself and resolve it again on the destination device.

Keep HeroUI, HTML language, CodeMirror phrases, xterm accessibility labels, formatting, sorting and Go-owned native UI synchronized. The Vite locale-context alias makes HeroUI providers and overlays share one React Aria context; verify it when dependencies change.

Follow the [localization contract](architecture.md#localization-and-collaboration) for initialization, translation boundaries and state preservation. Keep original error objects/metadata in transient state so open notices can update; retain unknown diagnostics and remote output. Test language changes with pending operations and actual editor selection/history, as in the [frontend tests](#frontend-tests). Preserve published release notes in their original language.

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

The SSH workspace's right tool rail opens files, monitoring, the enabled AI assistant, port forwarding, snippets and Docker. Use Tab or the arrow keys to reach its buttons. Docker opens an independent tool tab with the current SSH workspace selected. Layout, focus mode and reconnect actions remain in the workspace header.

The remote file tree shows its batch action bar when files are selected and collapses it when the selection is cleared. Keyboard selection and select-all remain available from the tree.

The remote editor's **Save and validate** action opens the existing file workflow and saves the draft before running its configured validation command. A missing command opens configuration without saving or guessing a command. Ordinary Save and opening **History and validation** do not execute commands. Reload still requires successful validation and a separate confirmation; a configured health check follows successful reload. The request belongs to the current SSH instance: reconnecting never replays the action, and closing its owner during a save/refresh prevents late validation. See [the workflow](../frontend/src/features/files/FileHistoryDialog.tsx).

The SSH port-forwarding panel previews the route as you edit: listener → SSH tunnel → destination. Local and dynamic forwards listen on this computer; remote forwards listen on the SSH host. Destination labels identify which side resolves and reaches the target. Port `0` is shown as automatically assigned until startup returns the actual listening address. The preview does not start a tunnel. See [the panel](../frontend/src/features/tunnels/TunnelPanel.tsx) for effective fields.

**Tools → File transfers** opens a persistent dual-pane tool tab. Each side selects the local filesystem or an already connected SSH workspace. Browse paths, select files/directories, preview the copy direction and explicitly select differences before copying; text comparison opens separately. The existing transfer panel opens with the tab and shows background tasks, speed, remaining time, failures and explicit resume. Switching tabs retains paths and selections; hidden file views stop directory reads. A disconnected endpoint stays selected and blocks new copies until a connected workspace is explicitly selected. Closing the tool tab releases its reads and unexecuted preview, without closing SSH connections or cancelling admitted transfers. The tool is excluded from layouts and named working sets. Directory browsing and copy limits remain defined by [the browsing API](../internal/app/transfer_browser.go), [sync scan](../internal/files/sync.go) and [execution](../internal/app/sync.go).

- **Connections:** the fixed connection center manages groups, filters and saved metadata. Environment, tags and saved filters are under **Filters**; active conditions remain visible and **Clear filters** also resets the protocol. The catalog footer shows the result count and selection actions. Outer tabs hold connection workspaces or independent multi-host, log, Docker and file-transfer tools; SSH inner tabs hold terminals/files. The workspace switcher stays outside the scrolling tab strip, and duplicate file names show distinguishing parent paths. Quick connect parses supported addresses/options for review and does not execute the entered text.
- **Identity and credentials:** verify new fingerprints/certificates against a trusted source. Changed identities block connection. Review legitimate changes in identity settings. Shared credential updates require reviewing the affected connection set.
- **Storage and lock:** explicitly choose master password/session storage if the system keychain is unavailable. Connection metadata is not whole-database encrypted. Application lock blocks new interaction while existing sessions/tasks can continue. Forgotten passwords require an independent backup.
- **Files:** enable file browsing mode to block new file writes in that SSH workspace. It does not restrict terminal/task commands or cancel operations already started. Upload is in the file panel's options menu; bookmarks and paste use named icon buttons. Saving checks the remote baseline and preserves drafts on conflict. The editor toolbar shows save state; encoding and line endings are in its status bar. Reload, download and manual completion are in editor options. Recovery actions follow the failed operation, and draft-download errors remain separate from remote save errors. Encoding, history recovery, sudo authorization, validation and reload are separate decisions.
- **Transfers:** preview conflicts and selected differences. The panel groups tasks by batch, actual target and direction; finished entries can be expanded while running and failed entries stay visible. Resume and staging cleanup have separate confirmation flows. Removing a record works offline and leaves staging files; confirm the loss of resume data before removal. Explicit cleanup removes staging first and retains the record on failure. Resume explicitly after reconnecting to the same verified destination. Directory sync does not delete extra destination files. See the [transfer lifecycle contract](architecture.md#communication-backpressure-and-lifecycle).
- **Terminal tools:** snippets await explicit insertion; completion integration is enabled per shell session. Multi-host steps use separate shells. Review the first-host confirmation before continuing. Saved run results are locally encrypted and excluded from regular backups.
- **Local terminals:** use the fixed **+** beside the workspace tabs or **Local terminal** in the connection center. The adjacent menu selects a shell, opens a native directory picker or reuses a recent directory. New local tabs inherit the selected local shell's directory. macOS/Linux query the shell process on demand; local OSC 7 reports update labels and supply the confirmed directory on other platforms. Without either source, the launch directory remains the baseline. Remote-host reports are ignored. Tabs show directory names and distinguishing parent paths; manual names survive directory changes. Recent launch directories stay on this device, outside backups. WSL retains its Linux home by default and accepts explicitly selected Windows directories; WSL OSC paths are not mapped to native directories.
- **Terminal fonts:** under **Settings → Terminal and editor → Monospace font → Custom**, enter the family name of a font installed on this computer, for example `JetBrainsMono Nerd Font Mono`. Nerd Font Mono families provide fixed-width icons for prompts such as Powerlevel10k. The preference applies to terminals, editors and the settings preview, persists locally and travels with UI settings backups. Missing fonts use the existing monospace fallbacks; the app does not download fonts. Font changes preserve open sessions and editor drafts/history.
- **Monitoring/logs:** Linux collection uses existing tools and current-user permissions. Preserve unknown, stale, truncated and partial states. [Docker containers](#docker-containers) use a dedicated tool tab over an SSH-forwarded Unix socket.
- **AI:** questions, explicitly attached references and tool-read contents go to the configured model service. Review command approvals. Stopping, locking or disconnecting invalidates pending approvals; operations already sent may still have unknown remote state.
- **RDP:** check the [TLS compatibility boundary](architecture.md#embedded-rdp) before connecting. Clipboard is opt-in per session. The Windows system client owns its authentication/identity UI and does not report remote connection success to the app.
- **Language/demo:** choose **Settings → Appearance → Language**. Demo mode uses isolated in-memory data while real workspaces remain mounted. Demo results do not prove remote behavior.
- **Backups:** encryption passwords are separate from WebDAV login passwords. Explicitly include credentials when needed. Full replacement removes the local credential set even when the snapshot has none. Restored tunnel auto-start is paused; reselect local private key files and verify sync paths.

AI turns continue beyond a fixed tool-call count while their runtime budget allows. Near budget exhaustion or after repeated identical tool failures, the assistant stops tools and requests a text-only summary within the remaining budget. Review the results before sending a new question. Summary failure is reported; stopping, locking or disconnecting cancels it. Batch parsing limits, output/context/history bounds and individual command approvals still apply. See [AI ownership and budgets](architecture.md#ai-ownership-and-approvals).

**Terminal shortcuts:** **Settings → Keyboard shortcuts → WezTerm** applies the supported Control-based bindings for new local tabs, tab switching/search, copy/paste, close, find and font size. Existing custom bindings stay until explicitly replaced. Control and Command are distinct on macOS. New local terminals and new terminals inside SSH workspaces have separate actions. Terminal search starts with the current selection.

The preset also binds **Shift+Enter** to modified Enter in the focused local terminal for TUI multiline input. When the local PTY enables Windows `win32-input-mode`, [terminal input](../frontend/src/features/terminal/windowsInput.ts) preserves Ctrl+J and modified Enter as Win32 key records. The newline action uses Shift+Enter records in that mode and [CSI-u modified Enter](https://sw.kovidgoyal.net/kitty/keyboard-protocol/) otherwise. Clear **Insert newline in local TUI** for shells/apps that do not consume modified Enter. IME composition keeps its own Enter handling.

The [terminal palettes](../frontend/src/features/settings/appearance.ts) use a subdued ANSI bright-black color in Classic Dark and when following a dark interface theme, reducing the brightness of TUI panels. The [terminal view](../frontend/src/features/terminal/TerminalView.tsx) enables xterm's minimum-contrast adjustment for text so gray foregrounds remain readable in both renderers. Explicitly dimmed text and background glyphs follow xterm's contrast rules.

**Settings → Terminal and editor → Copy terminal selection on mouse release** enables PuTTY-style copying for terminal selections. It is [disabled by default](../frontend/src/features/settings/appearance.ts). Releasing the left mouse button after selecting terminal text copies it to the system clipboard, including when the pointer leaves the terminal. The preference applies to existing terminals and travels with portable UI settings. Clipboard errors appear at the terminal.

Terminal selection copying removes trailing ASCII spaces from each logical line after xterm joins soft-wrapped rows. Automatic, shortcut, menu and browser copying share this rule, including intentionally entered trailing spaces. Leading indentation, internal spaces, blank lines and line endings are preserved; rows containing only spaces become empty lines.

In a local terminal's actions menu, **Paste multiline text directly** disables multiline confirmation for that PTY until it closes. **Confirm multiline paste** restores it. The default remains confirmation, and explicit shell-integration setup always uses its preview. Direct paste preserves the application's bracketed-paste mode. While browsing normal-buffer history, new output leaves the viewport in place and **New output** returns to the live position. Pane titles follow bounded terminal title reports; directory tracking remains separate.

Local paste reads text through the native clipboard. If there is no text and the native clipboard advertises an image, it sends Ctrl+V to the TUI, preserving negotiated ConPTY key records. The local CLI owns image retrieval and attachment; image bytes are not sent as terminal text. Image-only browser paste events follow the same shortcut path. This requires a CLI with native clipboard-image support; remote terminals cannot read the host clipboard this way. Native file drops insert quoted absolute paths without Enter, using the target PTY's actual shell kind. [Input preparation](../internal/app/local_terminal_input.go) bounds file count/input bytes and rejects unavailable paths, control characters, unsafe cmd.exe expansion and unconfigured WSL path mapping.

A BEL from an unfocused terminal marks that pane/workspace **Needs attention**. Focusing that terminal acknowledges it; focusing a different pane does not. **Enable terminal bell notifications** explicitly requests system notification permission for the session. Repeated bells coalesce until acknowledgement, and notification activation returns to the owning terminal. Bell handling does not infer completion or approval requests from output text. Existing shell-integration completion states/reminders remain available independently.

Closing an active local terminal requires confirmation; exited terminals close directly. Application exit or update restart lists active local sessions alongside existing task/draft checks. Canceling keeps the sessions open. Layout recovery does not restart local processes.

The [local workspace](../frontend/src/features/terminal/LocalTerminalWorkspace.tsx) supports single, two-column, two-row, three-column, three-row and four-pane layouts. Layout changes reuse existing terminals and open missing panes in the focused terminal's confirmed directory. Reducing visible panes retains other sessions in **Workspace terminals**. Drag a pane title onto another pane to exchange positions; drag a divider to resize or double-click to equalize. Divider arrow keys adjust ratios. On a focused pane title, arrows focus neighboring terminals and Shift+arrows exchange positions. **Maximize pane** retains the other sessions. These operations preserve PTYs, xterm instances and buffers.

**New terminal** opens inside the selected local/SSH workspace; **New local terminal** creates an outer workspace. Closing the current tab closes the focused terminal; closing the outer workspace confirms all running sessions, including hidden ones. Local focus-direction shortcuts default to Command+Option+arrows on macOS and Ctrl+Alt+arrows elsewhere, and remain configurable under keyboard settings. The [global local-PTY limit](../internal/app/local_terminal.go) counts every session, including hidden panes.

### Terminal rendering

**Settings → Terminal and editor** provides separate **Local terminal renderer** and **Terminal renderer** controls. Local terminals default to WebGL; SSH/container terminals default to basic rendering. The [appearance defaults](../frontend/src/features/settings/appearance.ts) define these preferences; [TerminalView](../frontend/src/features/terminal/TerminalView.tsx) selects the applicable one. WebGL loads on demand. Hiding a terminal retains its renderer, with inactive renderers eligible for eviction under the [shared retention policy](../frontend/src/features/terminal/webglRenderer.ts). Closing the terminal releases it. Initialization failure or context loss reports an error and restores basic rendering.

The pinned xterm version supports synchronized output (DEC 2026), allowing participating TUIs to finish a screen update before it becomes visible. Parsing acknowledgements continue during synchronized output. Applications that do not send synchronized updates still require workload-specific flicker checks. Rendering evidence and platform gaps belong in the [verification ledger](#local-terminal-workspaces-and-tui-verification-2026-11-10).

### Docker containers

Open **Tools → Docker**, **SSH session actions → Docker containers**, or the **Docker container workspace** command. The tool selects the current SSH workspace when opened from it and reads containers automatically. Resize the container list, filter by name/image/project or state, and use **Overview**, **Logs**, **Terminal**, and **Mounts and ports**. Compose labels group existing containers; this is not Compose deployment, image management, or Kubernetes support.

The SSH server must allow Unix socket forwarding and the login user must already have socket permissions. **Connection settings** applies a custom/rootless socket explicitly. Saved SSH connections retain it in local [connection preferences](../internal/store/preferences.go); temporary connection changes apply to the current selection. Connection preferences are ordinary local settings, not credential storage. No Docker TCP listener, remote dependency installation, or automatic elevation is needed.

**Overview** includes health checks and their recent output, exit status, OOM and restart count. Visible running containers sample CPU, memory including cache, and cumulative network/disk I/O; missing metrics remain unknown. Logs load when their page opens and share the bounded log viewer, filtering Worker, copy and scroll controls. **Follow** rereads a recent window and does not guarantee a complete archive. **Add to multi-source logs** keeps the actual SSH instance, socket and container ID. Hidden/minimized/locked pages stop log reads and resource sampling. Switching tool tabs preserves selection and read content; disconnect preserves cached content without automatically binding to a new SSH instance.

Container terminals use the shell selector's supported choices, enforced by the [Docker client](../internal/docker/client.go). They remain mounted when selecting other containers or hosts and can be reached from the open-terminal menu. They do not offer host filesystem completion, host tmux management, recording or snippets. Closing a terminal, the Docker tab, or its SSH workspace releases its channel; it does not prove the container process terminated. Confirm the SSH target, container name, full ID and action before start/stop/restart. A completed operation followed by a failed state refresh is reported separately. Canceling a request does not undo a remote state change. Mount actions open host directories; port actions create SSH-workspace-owned local tunnels, which remain manageable after closing Docker. Runtime limits remain in the client and [workspace service](../internal/app/docker.go).

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
go test -count=1 -v ./internal/backup -run '^TestRealWebDAV$'
go test -count=1 -v ./internal/app -run '^TestSavedConnectionFileEditing$'
```

The workflow-only command is an alternative to the full SSH selection. Use `-race` where supported. The [saved-connection file test](../internal/app/files_integration_test.go) uses `TERMQUAY_TEST_SAVED_CONNECTION`, `TERMQUAY_TEST_HOST_FINGERPRINT` and the system vault; it does not implement master-password unlock. Read the test before using it. Configured real-service tests also run under ordinary `go test` package selections; missing settings cause skips, which must be reported separately from passes.

### Known SSH test deadline failures

The [historical SSH run](development.zh-CN.md#ssh-verification-2026-11-05) recorded deadline failures in `TestSG1Transfers` and `TestSG1Forwarding`. Their internal context and I/O deadlines remain in [transfer_test.go](../internal/app/transfer_test.go) and [forward_test.go](../internal/ssh/forward_test.go). Increasing `go test -timeout` does not extend those internal deadlines. Temporary overlays passed the recorded scenarios with longer deadlines; they do not establish that the unmodified tests pass on that link. The ledger contains no later passing result for these unmodified tests. A follow-up needs the same verified target, measured link conditions and cleanup of the run's staging files before deciding whether the deadlines or application behavior need correction.

<a id="已有验收记录与缺口"></a>
<a id="重连修复与验证缺口"></a>
<a id="内置-ai-验收2026-11-06"></a>
<a id="windows-ssh-ai-适配验收2026-11-09"></a>
## Verification and known gaps

Report unit tests, local protocol integration, browser substitutes, native desktop, real SSH, real RDP and real WebDAV separately. A browser substitute, local SSH fixture or cross-build cannot establish native/real-remote acceptance.

Historical evidence and unresolved gaps remain in the [Chinese acceptance ledger](development.zh-CN.md#已有验收记录与缺口), including [AI acceptance](development.zh-CN.md#内置-ai-验收2026-11-06) and [Windows SSH AI adaptation](development.zh-CN.md#windows-ssh-ai-适配验收2026-11-09). Platform input/IME, RDP clipboard/concurrency, native menus/dialogs, real multi-hop reconnect, provider behavior and sustained application-wide resource measurements need environment-specific evidence. Do not present historical results as current checks.

### Terminal defaults reset correction

<a id="known-settings-reset-defect"></a>
Source inspection at `efa0a1c` found that selecting basic rendering for local terminals, then choosing **Restore defaults** under **Terminal and editor**, retained that selection instead of restoring the WebGL default. Commit `be8115c` added the independent preference without extending the [reset handler](../frontend/src/features/settings/AppearanceSettings.tsx). The handler now restores both renderer preferences from [appearance.ts](../frontend/src/features/settings/appearance.ts). The [component regression](../frontend/src/features/settings/AppearanceProvider.test.tsx) failed before the correction and passed afterward, including persistence across remounts and retention of unrelated appearance settings. This fixes the omission without changing the renderer defaults.

### Release 1.4.4 verification (2026-11-10)

Runtime fixes at `e9046cb` were checked on macOS 26.6.2 / arm64, Go 1.26.10, Node 26.11.0 and pnpm 11.20.0. `pnpm verify` passed formatting, frontend lint/build, Go vet/package tests, 5 script checks, 123 frontend tests and 37 pinned Chromium regressions. A separate `pnpm check` passed. Existing macOS SDK/deployment-target and duplicate Objective-C linker warnings remain. The version resources and bilingual release log passed the version tool; the dependency/license release audit passed without changing dependency inputs.

Both new regressions failed against the preceding implementation before passing with the fixes. The settings test exercises the actual appearance provider and reset action, persisted renderer preferences, remounting and retention of unrelated appearance preferences. The file-tree browser test uses the actual component with demo directory data and substituted Wails calls. It covers English/light and Chinese/dark views at 220, 300 and 420 pixels, Space selection, select-all and clearing selection. The empty toolbar previously reserved 44 pixels, leaving a 52-pixel gap below the path bar; after correction, the toolbar takes no space and the remaining list inset is 8 pixels. Screenshots were inspected at 300 pixels in English/light and 220 pixels in Chinese/dark, including the selected-action state without horizontal overflow.

The earlier Windows CI run at `bdab488` [timed out](https://github.com/Sanjeever/termquay/actions/runs/42771611792) in the console-key fixture's `ClosePseudoConsole` cleanup after closing its output reader. The [fixture](../internal/app/local_terminal_windows_test.go) now keeps draining output until console teardown completes, following the [Windows pseudoconsole lifecycle](https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session#ending-the-pseudoconsole-session). All four key-record assertions remain enabled. Windows amd64 test cross-compilation passed on the macOS host; that establishes compilation, not Windows execution. The first candidate/CI runs at `79a4d6a` were canceled to include this correction before release.

Candidate and tag commit `c94db86` passed [three-platform CI](https://github.com/Sanjeever/termquay/actions/runs/42843734971), including Linux race detection and the Windows ConPTY key-record fixture, and the [manual candidate workflow](https://github.com/Sanjeever/termquay/actions/runs/42843753240). All three downloaded candidate archives matched `SHA256SUMS` and had the expected top-level executable or `.app`. The macOS candidate contained x86_64/arm64, passed strict signature-integrity verification, reported 1.4.4 in its plist and executable, and ran CLI help on the local arm64 host.

The [tag workflow](https://github.com/Sanjeever/termquay/actions/runs/42846576573) succeeded and published [v1.4.4](https://github.com/Sanjeever/termquay/releases/tag/v1.4.4) as the latest stable Release on 2026-11-10. All three downloaded public archives matched the published `SHA256SUMS` and expected top-level structure. The public macOS package also contained both architectures and passed strict signature-integrity, version and CLI-help checks on the local arm64 host. Its signature was ad-hoc, without Developer ID authentication; x86_64 execution and native GUI behavior were not checked. The public Release body exactly matched the repository version log.

These checks do not establish native WebView, physical keyboard/IME, real SSH/RDP/WebDAV, old-to-new desktop upgrades or sustained resource behavior for these fixes. Earlier native terminal evidence remains in its separate dated records. Both README entry points, architecture/development guides, AGENTS.md, affected callers, comments, examples, CLI help and the distributed skill were checked for documentation impact. Usage guidance and the prior defect record were updated; service/model signatures, generated bindings and translation keys did not change.

### Workbench workflow and resource verification (2026-11-10)

Changes `81cc0d9`–`9adbf08` were checked on macOS 26.6.2 / arm64, Mac16,10 with 16 GiB RAM and 10 logical CPUs, Go 1.26.10, Node 26.11.0 and pnpm 11.20.0. Formatting, frontend lint, TypeScript, the production frontend build, Go vet and Go package tests passed. Script/frontend suites passed 5 script checks and 122 frontend tests. The full pinned Chromium suite passed 36 regressions at `1b30c1a`; all 6 workflow regressions also passed with the subsequent table-width fix. The later response-fixture timing correction passed 6 workflow component tests, its editor browser regression and formatting/lint/TypeScript checks. These commands ran individually rather than through a new aggregate `pnpm verify` invocation. Existing macOS SDK/deployment-target and duplicate Objective-C linker warnings remain.

Browser checks mounted actual React/editor/monitoring components with substituted Wails boundaries. They covered bilingual narrow monitoring, live local/remote/dynamic forwarding-route updates, retained dual-pane paths/selections across tabs and language changes, cross-host copy arguments and selected differences, disconnected endpoints without local fallback, and the actual App tools menu/tab/transfer-panel lifecycle. Editor checks covered ordinary Save without commands, explicit save-before-validation, missing/failed validation, separate reload confirmation followed by health checks, and owner closure preventing late validation. Browser layout was inspected at 620, 760 and 1280 pixels. This does not prove real SSH/SFTP or native remote operations.

A separate native diagnostic used production assets built at `1b30c1a` in the actual workbench and macOS WKWebView. Temporary startup and framework copies selected session storage, a separate CLI endpoint, a nonpersistent WebKit data store, a hidden 1280×820 window and a Bash wrapper without user profiles. Runtime services, Wails Streams, Go PTYs and xterm/WebGL remained real. A 20 ms diagnostic command-file poll remained active; an optional 20 ms JavaScript heartbeat kept the hidden view awake during the active-output sample. No framework/module-cache or product source was changed by this harness. These differences prevent treating it as normal foreground desktop acceptance.

The resource sample followed the application PID and the GPU, Networking and WebContent processes created with it. RSS below is their sum in MiB, excluding local shell/sleep processes; shared pages can be counted more than once, so this is not private physical footprint. Samples were five seconds apart. CPU estimates use cumulative CPU-time differences, include diagnostic overhead and use 100% for one logical CPU.

| Phase | Observed span | RSS first / last / peak | Mean / maximum interval CPU |
| --- | --- | --- | --- |
| Empty connection center | 30.2 s | 320.0 / 320.3 / 320.3 MiB | 3.4% / 4.0% |
| Four PTYs emitting output, heartbeat off | 60.4 s | 397.4 / 324.0 / 446.1 MiB | 10.7% / 51.2% |
| Continued four-PTY output, heartbeat on | 60.4 s | 345.4 / 362.5 / 362.5 MiB | 63.8% / 69.9% |
| After closing the workspace, heartbeat off | 30.2 s | 382.1 / 382.0 / 382.1 MiB | 2.3% / 3.6% |

Each of four shells ran 1,000 batches of 100 numbered lines with a requested 50 ms pause per batch. All four completion titles and final numbered lines were observed after roughly 145.5–145.9 seconds; the run included hidden-view throttling and a later heartbeat change, so it is not a throughput benchmark. Four WebGL instances produced eight canvas elements, with 80×24 terminal geometry and bounded 5,024-line buffers. No operation alerts appeared. Before this load, 50 sequential inputs through xterm's input API, the real PTY and the output title parser measured P50 10 ms, P95 15 ms and maximum 19 ms. After the load, all four terminals responded to an interrupt followed by another command; the title round trips took 4–5 ms. These measure injected input to parsed output, not physical keyboard or paint latency, and do not establish latency under sustained load.

After confirmed workspace closure, backend local-terminal count fell from four to zero, terminal/canvas elements disappeared and the sampled goroutine count returned from approximately 34–36 to 18, compared with 17 before opening terminals. Go heap allocation was approximately 3.8 MiB immediately after closure. RSS stayed above its initial value during the 30-second observation; neither a leak verdict nor long-duration memory stability follows from this run. The native workbench also opened the new file-transfer tab, browsed the isolated test directory through the real local browsing API in both panes, retained its component when switching tabs, closed the tool while retaining the transfer panel, and showed no page overflow or operation alerts. No remote files were copied by this native check.

Windows/Linux native WebViews, foreground paint/input latency, physical IME/clipboard, long-duration resource stability, real SSH/SFTP cross-host transfer, real RDP/WebDAV and upgrade flows remain unverified for this change. No performance improvement over the parent commit is claimed. README entries, architecture/development documents in both languages, contributor instructions, affected translations, direct callers, CLI help/examples and the distributed Agent skill were reviewed for documentation impact; CLI/protocol/default/backup contracts and generated bindings did not change.

### Release 1.4.3 verification (2026-11-10)

Candidate and tag commit `b8e0967` passed [three-platform CI](https://github.com/Sanjeever/termquay/actions/runs/42746293453), including Linux race detection, and the [manual candidate workflow](https://github.com/Sanjeever/termquay/actions/runs/42746296250). On macOS 26.6.2 / arm64, Go 1.26.10, Node 26.11.0 and pnpm 11.20.0, local `pnpm verify` passed formatting, frontend lint/build, Go vet/package tests, 5 script tests, 114 frontend tests and 8 Chromium regressions. TypeScript checking, targeted portable-settings tests, version synchronization and the release audit also passed. Existing macOS SDK/deployment-target linker warnings remain.

The first candidate at `8e2915e` failed the WezTerm preset regression on Linux and Windows because Control+Shift+W normalized to a reserved combination. The added platform regression reproduced both failures on the local host before the fix. `b8e0967` aligns frontend and portable-settings validation for the close action while retaining duplicate and reserved-combination rejection. Bilingual shortcut guidance and related README, architecture, contributor, CLI/example and distributed-skill entry points were checked; their intended behavior remains accurate.

All three downloaded candidate archives matched `SHA256SUMS` and had the expected top-level executable or `.app`. The macOS candidate contained x86_64/arm64, passed strict signature-integrity verification, reported 1.4.3 in its plist and executable, and ran CLI help on the local arm64 host. Its signature was ad-hoc, without Developer ID authentication. This release check did not repeat native GUI, real SSH/RDP/WebDAV, old-to-new desktop upgrade or sustained resource acceptance. Earlier native local-terminal evidence is recorded separately below; Chromium platform styles do not establish native WebView behavior.

The [tag workflow](https://github.com/Sanjeever/termquay/actions/runs/42747390194) succeeded and published [v1.4.3](https://github.com/Sanjeever/termquay/releases/tag/v1.4.3) as the latest stable Release on 2026-11-10. All three downloaded public archives matched the published `SHA256SUMS` and expected top-level structure. The public macOS package also passed strict signature-integrity, version and CLI-help checks on the local arm64 host. The public Release body exactly matched the repository version log. The requester received the release link and toolbar-fix confirmation in [issue #1](https://github.com/Sanjeever/termquay/issues/1#issuecomment-6758024118).

### Local terminal workspaces and TUI verification (2026-11-10)

Changes through `1b9e831` were checked on macOS 26.6.2 / arm64, Go 1.26.10, Node 26.11.0 and pnpm 11.20.0. `pnpm verify` passed formatting, frontend lint/build, Go vet/package tests, 5 script checks, 116 frontend tests and 30 pinned Chromium regressions. Targeted local-terminal, output relay/coalescer and renderer-preference tests passed with Go race detection. A Windows amd64 production cross-build passed; regenerated bindings left no diff, and the dependency/license input check passed. Existing macOS SDK/deployment-target linker warnings remain.

Browser coverage used actual React/xterm/WebGL with substituted native calls/streams. It checked all six layouts, drag/keyboard pane exchange, divider changes, immediate input after focus switching, maximize/restore, hidden-session retention, language switching, close confirmation/cancellation, partial creation failure and late-PTY cleanup. Rendering checks retained canvases across hiding and compared screenshots while a synchronized update was incomplete. Input checks covered opt-in direct bracketed paste, legacy/ConPTY image-shortcut bytes, quoted drop routing/input lock, Ctrl+C, Esc, Tab/Shift+Tab, Ctrl+J, existing IME regressions, history browsing and explicit bell attention. Both light/dark views and a 760×650 four-pane layout were inspected without page overflow.

A final browser visual check reproduced incorrectly scaled/offset text when the physical canvas backing size exceeded the GPU viewport. The device-pixel regression first failed against the unpatched addon, then passed with the [local WebGL patch](../frontend/patches/@xterm__addon-webgl@0.19.0.patch). The regression substitutes doubled device-pixel observations; a separate visual check confirmed a 672×520 backing store and matching viewport after the fix, with correctly positioned text. This does not establish physical multi-monitor DPI transitions on native platforms.

A separate real PTY diagnostic ran npm 11.20.0 against a temporary local file dependency with offline, script-free installation and an isolated cache. It observed cursor positioning, line erasure and the replacement Braille glyph in separate reads, sometimes microseconds apart, without synchronized-output markers. The relay regression verifies that adjacent erase/replacement writes reach xterm together while preserving bounded buffers, byte identity, read errors and parsing acknowledgements.

A temporary production-built native fixture mounted the same local-workspace/terminal components in a hidden macOS WKWebView. A Go startup overlay selected session storage and a temporary shell wrapper without user shell profiles; real Wails calls/Streams, Go PTYs and the output relay remained in use. Go-driven test ticks kept the hidden fixture active. It checked four WebGL contexts, Unicode input through a real shell, title reports, synchronized-update byte flow, successful isolated npm installation with parsed spinner glyphs, 8,000 lines across four PTYs, retained instances/canvases across all layouts and hiding, and Ctrl+C followed by responsive input. Codex CLI 0.167.0 and Claude Code 2.1.322 startup interfaces were observed without submitting model turns. No terminal operation errors were reported.

The hidden native run did not capture npm spinner paint frames, so its successful installation does not establish foreground animation quality. Foreground desktop animation, physical IME input, actual clipboard-image attachments, native file dragging, system notification permission/activation, Windows/Linux native WebViews and sustained application/WebView resource measurements remain acceptance gaps. The native fixture's entry point/storage/scheduler differed from normal desktop startup; it is not full-workbench or model-provider acceptance. These changes do not restart local processes during layout recovery.

### Local terminal workflow verification (2026-11-10)

Runtime changes through `81a3c93` were checked on macOS 26.6.2 / arm64, Go 1.26.10, Node 26.11.0 and pnpm 11.20.0. `pnpm verify` passed formatting, frontend lint/build, Go vet/package tests, 5 script tests, 111 frontend tests and 8 Chromium regressions. The targeted local-terminal/portable-settings race tests and Windows amd64 production cross-build passed. Regenerating bindings left no diff. Real SSH/WebDAV settings were excluded from the aggregate run; their absence is not remote acceptance. Existing macOS SDK/deployment-target linker warnings remain.

Native checks used production frontend assets and the actual local PTY stack. Temporary Go overlays isolated business storage, and a temporary process environment isolated the CLI endpoint. Coverage included the visible launcher, native directory picker, directory-based labels, `cd` followed by directory inheritance without OSC reports, the WezTerm preset, native clipboard copy/paste, multiline confirmation and close/quit confirmation with cancel. Codex CLI 0.167.0 and Claude Code 2.1.318 rendered in separate local tabs; Unicode/multiline paste and modified Enter were exercised without treating model-answer quality as terminal acceptance. The final `81a3c93` native build separately confirmed that the terminal regains focus after paste-dialog removal.

The rapid-confirmation browser regression failed with duplicate input when single-use paste consumption was removed, then passed after restoring it. It checks actual xterm bracketed input and focus through substituted clipboard/stream boundaries. Native tests separately exposed WebKit clipboard permission failure, which was corrected using the existing Wails clipboard API. Windows/Linux native WebViews, WSL directory behavior, physical IME composition, clipboard images and sustained resource measurements remain unverified for this change. Local layout restoration still does not restart processes.

### Quality-tool integration verification (2026-11-10)

The formatting baseline is `50c4c0b` and Hook/lifecycle changes are `47382e7`. These source changes and the quality configuration/browser fixtures committed with this record were checked on macOS 26.6.2 / arm64, Go 1.26.10, Node 26.11.0 and pnpm 11.20.0. The aggregate `pnpm verify` passed formatting, Oxlint, the TypeScript/production frontend build, Go vet, 5 script tests, 103 frontend tests, Go package tests and 7 Chromium regressions. An offline frozen-lockfile install and the release audit passed. Temporary unused-variable and formatting probes returned nonzero through the public check commands and the Go formatter; the probes were removed. Existing macOS SDK/deployment-target linker warnings remain.

The browser suite used the pinned Playwright package's Chromium revision and substituted Wails HTTP calls. It checked macOS/Windows/Linux header styles at two widths, zero/one/many workspaces, overflow and mouse/keyboard activation; editor checks retained the real CodeMirror instance, document, selection and undo history across language/theme/font changes. Platform styling in Chromium does not establish native WebView behavior, window dragging, real SSH/RDP/WebDAV/model-provider or upgrade acceptance. The new remote CI job has not run for these local commits. No version bump, tag, publication or remote settings change was performed.

The [dependency review](../build/licenses/review.json) compares the original lockfile at `53cb7cb`: all 588 existing package records and 588 snapshots, production resolutions, Go audit inputs and the RDP patch are unchanged. New records are development-only toolchains and platform bindings. Both README entry points, architecture/development guides, contributor instructions, comments, examples, CLI help and the distributed skill were reviewed for affected instructions; the canonical quality guide and Chinese entry point were updated.

### Custom font verification for 1.4.2 (2026-11-09)

The font fix is `b7e61ee`. On macOS 26.6.2 / arm64, Node 26.11.0 and pnpm 11.20.0, `pnpm test` passed 5 script tests and 103 frontend tests across 28 files. TypeScript checking, the production frontend build, version synchronization and release audit passed. Regression coverage checks legacy preferences, custom-family serialization/escaping, existing presets, persistence, reset and preservation of the actual CodeMirror instance, draft, selection and undo history during font changes. Both README entry points, architecture/development guides, AGENTS.md, comments, CLI help/examples and the distributed skill were checked for affected guidance; both usage guides now describe custom fonts.

The release candidate also updates Go's portable UI validator to accept custom fonts and reject non-string family values. `go test ./internal/app -run '^TestPortable' -count=1` passed with Go 1.26.10 on the same host, covering legacy/language preferences and custom font values. The existing macOS SDK/deployment-target linker warnings remain. No Go service/model signatures changed, so bindings are unchanged.

A Chromium browser harness mounted the real appearance provider, settings and xterm terminal, with Wails calls substituted at the boundary and fixed terminal output. The locally installed `FiraCode Nerd Font Mono` rendered prompt/icon glyphs, updated the terminal and preview font, retained the terminal DOM node during font changes and restored the preference after reloading. This is browser rendering evidence, not a live shell or native WebView check. Native three-platform font rendering, real Powerlevel10k sessions, old-to-new desktop upgrades and sustained resource behavior remain unverified for this patch.

Candidate and tag commit `e3cb45e` passed [three-platform CI](https://github.com/Sanjeever/termquay/actions/runs/42646313853), including Linux race detection, and the [manual candidate workflow](https://github.com/Sanjeever/termquay/actions/runs/42646316551). All three downloaded candidate archives matched `SHA256SUMS` and had the expected top-level executable or `.app`. On the local arm64 host, the macOS candidate contained x86_64/arm64, passed strict signature-integrity verification, reported 1.4.2 in its plist and executable, and ran CLI help successfully. This does not establish GUI behavior or execution on x86_64.

The [tag workflow](https://github.com/Sanjeever/termquay/actions/runs/42648552501) succeeded and marked [v1.4.2](https://github.com/Sanjeever/termquay/releases/tag/v1.4.2) as the latest stable Release at publication. All three downloaded public archives matched the published `SHA256SUMS` and expected top-level structure; the Release body matched the repository version log. The requester received the release link and font setup steps in [issue #1](https://github.com/Sanjeever/termquay/issues/1#issuecomment-6744568791).

### Documentation audit and 1.4.1 candidate verification (2026-11-09)

The candidate is `51dcbf2`. The audit compared README entries, architecture/usage guides, contributor instructions, configuration comments, CLI help/examples and the distributed skill against implementation, configuration, tests and history. It corrected stale transfer-removal and editor-action guidance, consolidated operational recipes/code navigation and preserved design rationale and historical evidence. Local checks covered 104 Markdown files outside vendored license texts, 551 local links/anchors and syntax checks for 15 shell examples. The [dependency review](../build/licenses/review.json) records the development-only lockfile delta and unchanged production resolutions.

On macOS 26.6.2 / arm64, Go 1.26.10, Node 26.11.0 and pnpm 11.20.0, `pnpm test` passed 5 script tests and 101 frontend tests across 28 files; `pnpm check` and `go test -race ./...` passed. Existing macOS SDK/deployment-target linker warnings remain. The [three-platform CI](https://github.com/Sanjeever/termquay/actions/runs/42637140057) and [manual candidate build](https://github.com/Sanjeever/termquay/actions/runs/42637138768) succeeded for the same commit, including generated-binding consistency and native CLI smoke checks. All three downloaded candidate archives matched `SHA256SUMS` and had the expected top-level program or `.app`. The macOS candidate contained x86_64/arm64, reported version 1.4.1 in its plist and executable, passed strict signature-integrity verification, and ran CLI help on the local arm64 host. Its signature was ad-hoc, without Developer ID authentication.

The [tag workflow](https://github.com/Sanjeever/termquay/actions/runs/42638513293) succeeded and marked [v1.4.1](https://github.com/Sanjeever/termquay/releases/tag/v1.4.1) as the latest stable Release at publication. All three downloaded public archives matched the published `SHA256SUMS` and expected top-level structure; the Release body matched the repository version log.

These checks add no native desktop interaction, real SSH/Docker/RDP/WebDAV/model-provider, old-to-new application upgrade or sustained resource acceptance. The macOS CLI checks do not establish GUI behavior or execution on both architectures.

### Frontend test migration verification (2026-11-09)

Changes through `e136b91` were checked on macOS / arm64 with Node 26.11.0, pnpm 11.20.0 and Vitest 5.1.0. `pnpm test` passed 5 Node script tests and 95 frontend tests across 27 files, including 23 new component/Hook cases. TypeScript checking, the production frontend build and offline frozen-lockfile installation passed. A filtered watch run entered its waiting state and exited cleanly; an invalid project filter returned a nonzero exit code through the root test command.

Coverage includes pending saves, later edits and format changes, repeated submission, error/retry behavior, stale session responses, reload confirmation, cancelled sudo authorization, unsaved-workspace close protection, native close-event coordination, local persistence failure, connection form validation/partial failure and quick-connect parsing. Language tests retain the actual CodeMirror instance, document, selection and undo/redo history, selected tab and pending save. The stale-save rejection regression failed before the session guard in `889ffb6` and passed after the fix.

Wails service/native-event calls use test doubles. jsdom supplies no real layout; these checks do not establish native WebView, real SSH/RDP/WebDAV, Windows/Linux behavior or sustained resource performance. No remote operations or native desktop acceptance checks were performed for this migration.

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
## Versions and releases

[frontend/package.json](../frontend/package.json) is the application version source; [scripts/version.mjs](../scripts/version.mjs) synchronizes platform resources. Database, backup and layout versions evolve independently.

Release operations require authorization. Before a bump, write `docs/releases/<version>.md` from the changes since the previous tag, English first and Chinese second in the same file. Commit the log with the version resources and preserve published logs/public versions. Run these commands in a sh-compatible shell, substituting the intended version:

```sh
next_version='<next-version>'
pnpm --dir frontend bump "$next_version"
node scripts/version.mjs check "v$next_version"
node scripts/release-check.mjs
```

The version tool validates the release log and resource structures before writing files; it does not commit or tag. Its accepted version format and synchronized resource list live in [scripts/version.mjs](../scripts/version.mjs), with regression coverage in the script suite. The release audit rejects registered pending items, changed audited dependency inputs and missing/empty WASM license files. Update the collected materials and review after dependency or patch changes; do not bypass a failed audit. A change confined to development dependencies still changes the audited lockfile: compare production resolutions and patch settings against the previous reviewed version and record that evidence before refreshing the input digest.

### Candidate and public release

Commit the candidate on `main`, push it, and manually dispatch the release workflow at that commit's branch. Confirm the run's `headSha` matches the candidate; dispatching a branch that has moved checks another commit. The manual run creates a `release-bundle` artifact with platform archives and `SHA256SUMS`, without publishing a Release:

```sh
git push origin main
gh workflow run release.yml --ref main
```

[CI](../.github/workflows/ci.yml) defines the check matrix. [The release workflow](../.github/workflows/release.yml) defines runners, architectures, artifact names and release flags. Candidate archives contain one top-level executable or `.app`, matching [the update provider](../internal/update/provider.go) and updater unpacking requirements. Candidates are formal builds and can check the currently public stable release. Keep [task inputs](../build/Taskfile.yml) current when adding source directories or Wails include resources so builds do not scan dependency links recursively.

Check candidate startup, system integration, core connections, unsaved-file exit protection and upgrade from an older program. Cover download failure/cancellation, checksum mismatch, unwritable installation directories and replacement failure. Record the candidate commit, environment, coverage and outstanding platform/service gaps in the [verification ledger](#verification-and-known-gaps). Native builds and test doubles do not establish desktop or real-remote acceptance.

After the candidate checks and audit, create an annotated tag for the same checked commit already on remote `main`, then push it:

```sh
candidate_commit='<verified-candidate-commit>'
git tag -a "v$next_version" "$candidate_commit" -m "Release v$next_version"
git push origin "v$next_version"
```

Tag runs repeat version, ancestry, tests and audit checks, build every target and assemble checksums before publishing. Release notes come directly from the version log; the update UI reuses that body. The workflow can complete an unpublished draft and rejects overwriting a public version. A green manual run proves candidate assembly; completion also requires a successful tag run and a public Release with all expected archives and checksums.

### Signing and license collection

Release linker flags are defined in the workflow. Ordinary local production builds retain the development marker and do not check/install updates. Windows archives currently have no Authenticode distribution signature. macOS uses ad-hoc signing unless the release signing settings are configured. For Developer ID signing, notarization and stapling, the workflow requires GitHub Secrets `MACOS_CERTIFICATE` (Base64 p12), `MACOS_CERTIFICATE_PASSWORD`, `MACOS_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_TEAM_ID` and `APPLE_APP_PASSWORD`. Keep their values outside the repository/logs. Checksums establish integrity; signing/authenticity is separate.

After production frontend dependency changes, export license metadata to an OS-appropriate temporary path and collect original texts:

```sh
license_metadata='<absolute-temporary-file-path>'
pnpm --dir frontend licenses list --prod --json > "$license_metadata"
node scripts/licenses.mjs "$license_metadata"
```

The collector removes installation paths and reports missing materials. Collection does not complete the audit: reconcile Go modules, prebuilt JavaScript/WASM provenance, actual distributed artifacts and [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) with the [review record](../build/licenses/review.json).

<a id="应用检查与安装更新"></a>
### Application updates

**Settings → About** shows the version, build commit, update state, release notes and licenses. Formal builds check after startup and periodically when automatic checking is enabled; settings stay local. A new version marks the settings entry without automatically downloading or restarting. After reviewing its notes, explicitly download and choose **Restart and update**. Cancellation of exit returns to the current application; unsaved files and persistence failures must be handled before updater handoff.

The project/platform/version and SHA-256 entry must match. Installation and parent directories must be writable; use the installer or manual replacement for managed locations. Binary replacement/recovery does not roll back data migrations. Scheduling and state live in [update.go](../internal/app/update.go); invariants are in [Releases and updates](architecture.md#releases-and-updates). The [Chinese update guide](development.zh-CN.md#应用检查与安装更新) retains the historical Windows helper verification and remaining native acceptance gaps.
