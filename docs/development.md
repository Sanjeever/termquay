# Development and usage

[简体中文](development.zh-CN.md) · [Contributing](../CONTRIBUTING.md) · [Architecture](architecture.md)

This guide covers an independent contribution from checkout to verification. The [Chinese guide](development.zh-CN.md) retains the longer operational manual and historical acceptance records. Those records have not been rerun merely by translating this entry point. Commands below run from the repository root.

<a id="环境与定义入口"></a>
## Environment

- Use the Go language/toolchain in [go.mod](../go.mod). Keep the Wails CLI aligned with its module version.
- Use the pnpm version in [frontend/package.json](../frontend/package.json), the checked-in [lockfile](../frontend/pnpm-lock.yaml), and a Node version compatible with pnpm/Vite. [CI](../.github/workflows/ci.yml) is the tested toolchain reference.
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

Install the matching Wails CLI into the ignored `.tools` directory.

Windows PowerShell:

```powershell
$wailsVersion = go list -m -f '{{.Version}}' github.com/wailsapp/wails/v3
$env:GOBIN = Join-Path (Get-Location) '.tools'
go install "github.com/wailsapp/wails/v3/cmd/wails3@$wailsVersion"
$env:PATH = "$env:GOBIN;$env:PATH"
wails3 dev
```

macOS / Linux, with a POSIX-compatible shell:

```sh
wails_version=$(go list -m -f '{{.Version}}' github.com/wailsapp/wails/v3)
GOBIN="$PWD/.tools" go install "github.com/wailsapp/wails/v3/cmd/wails3@$wails_version"
export PATH="$PWD/.tools:$PATH"
wails3 dev
```

Add `.tools` to PATH again in a new terminal. Development tasks generate bindings and start the desktop and Vite server. Browser previews do not verify the native Wails runtime.

<a id="日常修改与验证"></a>
## Changes and checks

After Go service/model/event changes, regenerate bindings and inspect the result:

```sh
wails3 generate bindings -ts -i
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

Frontend tests use [node:test](../scripts/test.mjs). CI also builds on three platforms, checks binding consistency and runs the [CLI smoke check](../scripts/cli-smoke.mjs). A workflow definition is not evidence that a check ran for your change.

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

- **Connections:** the fixed connection center manages groups, filters and saved metadata. Outer tabs hold connection workspaces or independent multi-host/log tools; SSH inner tabs hold terminals/files. Quick connect parses supported addresses/options for review and does not execute the entered text.
- **Identity and credentials:** verify new fingerprints/certificates against a trusted source. Changed identities block connection. Review legitimate changes in identity settings. Shared credential updates require reviewing the affected connection set.
- **Storage and lock:** explicitly choose master password/session storage if the system keychain is unavailable. Connection metadata is not whole-database encrypted. Application lock blocks new interaction while existing sessions/tasks can continue. Forgotten passwords require an independent backup.
- **Files:** browsing mode blocks remote writes until explicitly allowed. Saving checks the remote baseline and preserves drafts on conflict. Compare/merge or reload explicitly. Encoding, history recovery, sudo authorization, validation and reload are separate decisions.
- **Transfers:** preview conflicts and selected differences. Resume explicitly after reconnecting to the same verified destination. Directory sync does not delete extra destination files. Cancellation does not prove remote termination.
- **Terminal tools:** snippets await explicit insertion; completion integration is enabled per shell session. Multi-host steps use separate shells. Review the first-host confirmation before continuing. Saved run results are locally encrypted and excluded from regular backups.
- **Monitoring/logs:** Linux collection uses existing tools and current-user permissions. Preserve unknown, stale, truncated and partial states. Docker uses its HTTP API over an SSH-forwarded Unix socket.
- **AI:** questions, explicitly attached references and tool-read contents go to the configured model service. Review command approvals. Stopping, locking or disconnecting invalidates pending approvals; operations already sent may still have unknown remote state.
- **RDP:** embedded RDP currently uses TLS 1.2; TLS 1.3-only targets are unsupported. Clipboard is opt-in per session. The Windows system client owns its authentication/identity UI and does not report remote connection success to the app.
- **Language/demo:** choose **Settings → Appearance → Language**. Demo mode uses isolated in-memory data while real workspaces remain mounted. Demo results do not prove remote behavior.
- **Backups:** encryption passwords are separate from WebDAV login passwords. Explicitly include credentials when needed. Full replacement removes the local credential set even when the snapshot has none. Restored tunnel auto-start is paused; reselect local private key files and verify sync paths.

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
termquay task list --json --no-input
termquay run list --json --no-input
termquay exec --workspace '<exact-workspace-id>' --script-file ./inspect.sh --timeout 30s --json --no-input
```

Use the installed program's help as the command contract. On macOS it is inside `.app/Contents/MacOS/termquay`; Windows retains `.exe` and callers must wait and collect its exit code. IPC supports the same OS user/environment, not a container/WSL/remote-development proxy.

Saved connections are metadata, not evidence that a host is online. Workspaces identify backend SSH owners, not every frontend tab. Match `id`, `connection_id`, `target` and `state`; never execute against a fuzzy name.

File/service/port/container queries retain permissions, encoding, version, warnings and truncation. They do not start services, containers or tasks. Definitions/results may contain sensitive text. Run pagination uses `next_offset`, `has_more` and, on subsequent live pages, the first page's `summary.revision` as `--revision`. Restart pagination on `record_changed`.

Exec uses a separate non-PTY `sh -s` session without the interactive terminal's directory/environment. Prefer `--script-file` or stdin for multiline scripts. Check the process exit code, response-level `error.remote_state_unknown`, and `data.result.exit_code`, `error` and `truncated`. Decode bounded `stdout_base64`/`stderr_base64` on text decoding failure; do not replay a command to fix display. Cancellation/timeout/disconnect does not prove remote termination. The [Agent skill](../skills/termquay/SKILL.md) does not install the app or authorize arbitrary remote operations.

<a id="真实-ssh-与-webdav"></a>
## Optional real services

Community contributions do not require maintainer servers. Unit tests/local protocol services work without SSH/WebDAV credentials. Do not access someone else's server or add credentials merely to avoid a skipped test.

Real tests opt in through securely injected process settings. Never put real values in Git, screenshots or shell history:

| Suite | Configuration |
| --- | --- |
| `TestSG1*` password entry | `SSH_MCP_SERVER_SG1_HOST`, `SSH_MCP_SERVER_SG1_PORT`, `SSH_MCP_SERVER_SG1_USERNAME`, `SSH_MCP_SERVER_SG1_PASSWORD`, `TERMQUAY_TEST_HOST_FINGERPRINT` |
| `TestSG1Workflow*` | Host, port, username and verified fingerprint above, plus `TERMQUAY_TEST_PRIVATE_KEY_PATH`; no password required |
| `TestRealWebDAV` | `TERMQUAY_WEBDAV_URL`, `TERMQUAY_WEBDAV_USERNAME`, `TERMQUAY_WEBDAV_PASSWORD`, `TERMQUAY_WEBDAV_DIRECTORY` for an isolated writable collection |

Independently verify the target fingerprint. File tests create and clean their own `/tmp/termquay-*` directories. Do not change system/SSH/services/business files or install remote tools. Some workflow cases require existing sudo/tmux/Docker permissions. Follow [remote-operation boundaries](../AGENTS.md#credentials-and-remote-operations).

```sh
go test -count=1 -v ./internal/app ./internal/ssh ./internal/files ./internal/monitor -run '^TestSG1'
go test -v ./internal/backup -run '^TestRealWebDAV$'
```

Use `-race` where supported. The [saved-connection file test](../internal/app/files_integration_test.go) uses `TERMQUAY_TEST_SAVED_CONNECTION`, a verified fingerprint and the system vault; it does not implement master-password unlock. Read the test before using it.

<a id="已有验收记录与缺口"></a>
<a id="重连修复与验证缺口"></a>
<a id="内置-ai-验收2026-11-06"></a>
<a id="windows-ssh-ai-适配验收2026-11-09"></a>
## Verification and known gaps

Report unit tests, local protocol integration, browser substitutes, native desktop, real SSH, real RDP and real WebDAV separately. A browser substitute, local SSH fixture or cross-build cannot establish native/real-remote acceptance.

Historical evidence and unresolved gaps remain in the [Chinese acceptance ledger](development.zh-CN.md#已有验收记录与缺口), including [AI acceptance](development.zh-CN.md#内置-ai-验收2026-11-06) and [Windows SSH AI adaptation](development.zh-CN.md#windows-ssh-ai-适配验收2026-11-09). Platform input/IME, RDP clipboard/concurrency, native menus/dialogs, real multi-hop reconnect, provider behavior and sustained application-wide resource measurements need environment-specific evidence. Do not present historical results as current checks.

<a id="构建与本地打包"></a>
## Build and local packaging

```sh
wails3 build
wails3 task package
```

Builds go to `bin/`. Consult [platform tasks](../build): macOS packaging uses local ad-hoc signing; Windows NSIS needs `makensis`; MSIX/Linux formats need their tools. These documented workflows do not authorize publishing or signed distribution. Full tasks can run `go mod tidy` and regenerate bindings; inspect the diff and preserve build customizations. The [Chinese resource guide](development.zh-CN.md#构建与本地打包) retains detailed icon procedures.

<a id="版本与发布"></a>
<a id="应用检查与安装更新"></a>
## Versions and releases

[frontend/package.json](../frontend/package.json) is the application version source; [scripts/version.mjs](../scripts/version.mjs) synchronizes platform resources. Database, backup and layout versions evolve independently.

Before an authorized future bump, write `docs/releases/<version>.md`, English first and Chinese second in the same file, and commit it with version resources. Preserve published logs/public versions. Language/contribution work does not authorize a bump, tag, push, release or signed distribution.

Candidate artifacts/checksums and publishing are defined in [the release workflow](../.github/workflows/release.yml). Native candidate acceptance and [third-party audit gaps](../THIRD_PARTY_NOTICES.md) must be addressed before an authorized public release. Checksums prove integrity; signing/authenticity is separate.
