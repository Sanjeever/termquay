# TermQuay

[简体中文](README.zh-CN.md) · [Contributing](CONTRIBUTING.md)

TermQuay is an open source remote connection workbench built with Go, Wails v3 and React. It brings SSH, local terminals, remote file editing, Linux monitoring and embedded RDP into one desktop workspace. Connections can be grouped and backed up using encrypted local files or WebDAV snapshots. There is no commercial limit on saved connections.

Available for macOS, Windows and Linux. Download the appropriate archive from [GitHub Releases](https://github.com/Sanjeever/termquay/releases). Check [runtime prerequisites](docs/development.md#packaged-desktop) and the [recorded verification limits](docs/development.md#verification-and-known-gaps).

## Interface languages

Choose **Settings → Appearance → Language** to follow the system, use English or use Simplified Chinese. Both languages are bundled for offline use. Language selection is available before unlocking local data. Switching languages preserves open workspaces, connections, transfers and editor drafts.

<a id="当前能力"></a>
## Features

- **Connections** — groups, filters, configuration imports, connection playbooks, encrypted credentials and master password protection.
- **SSH and local terminals** — multiple authentication methods, jump hosts, SOCKS5 proxies, port forwarding, split panes, reconnect and connection diagnostics.
- **Files and transfers** — search, batch transfers, explicit resume, directory sync, comparisons and copies between hosts.
- **Remote editing** — encodings and line endings, completion, conflict merging, encrypted version history and explicit validation/reload commands. Preview Markdown and common image formats.
- **Terminal tools** — snippets, shell completion, tmux, recording/playback, background multi-host tasks, inspections and result comparisons.
- **Linux diagnostics** — resource trends, processes, systemd services, ports, multi-source logs and diagnostic snapshots.
- **Docker containers** — [Tools → Docker](docs/development.md#docker-containers) opens a dedicated tab for container status, resources, logs, terminals, mounts, ports and confirmed start/stop/restart operations over SSH.
- **AI assistant** — workspace conversations, explicit terminal references, capability-based remote queries, command approval and encrypted local history.
- **Remote desktop** — embedded RDP, SSH gateways and the Windows system client.
- **Local workspace** — named working sets, layout and draft recovery, appearance and keyboard shortcuts.
- **Encrypted backups** — local files and WebDAV snapshots with previewed recovery and selective configuration migration.

See [usage and boundaries](docs/development.md#using-the-workbench), including the [RDP TLS compatibility boundary](docs/architecture.md#embedded-rdp).

## Comparison with other tools

TermQuay is built for managing multiple hosts: edit configurations, inspect logs, compare task results and open remote desktops in one desktop workspace.

### OpenSSH / PuTTY

[OpenSSH](https://www.openssh.org/) provides command-line tools for SSH, file transfer and tunneling; [PuTTY](https://www.chiark.greenend.org.uk/~sgtatham/putty/) provides terminal access through SSH and other protocols. TermQuay brings connection groups, split terminals, graphical file management, remote editing and monitoring into a shared workspace. Named working sets and recovery of layouts and drafts help you return to ongoing work.

### MSTSC

[MSTSC (Microsoft Terminal Services Client)](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/mstsc) is Windows' Remote Desktop Connection client. TermQuay organizes SSH and RDP connections in the same catalog, with embedded desktops and SSH gateways for work across Linux and Windows hosts. On Windows, you can also launch the system client from a saved RDP connection.

### Xshell / SecureCRT

[Xshell](https://www.netsarang.com/en/xshell/) and [SecureCRT](https://www.vandyke.com/products/securecrt/index.html) offer terminal sessions, session management and scripting tools. TermQuay offers an Apache-2.0 open source workbench with remote editing, Linux diagnostics, multi-source logs and encrypted backups alongside terminals. Its source is available for inspection and customization, and saved connections have no commercial count limit.

### MobaXterm

[MobaXterm](https://mobaxterm.mobatek.net/) combines a Windows terminal, an X server and remote connection tools. Its [Home Edition](https://mobaxterm.mobatek.net/download.html) limits sessions and SSH tunnels; Professional Edition removes those limits. TermQuay provides a shared workbench interface on macOS, Windows and Linux, with no commercial limit on saved connections and encrypted backups for moving connection configurations between devices.

### FinalShell

[FinalShell](https://www.hostbuf.com/t/988.html) combines SSH, file management, monitoring and remote desktop access. TermQuay emphasizes the configuration editing workflow: handle conflicting edits, recover drafts from encrypted version history, and explicitly run validation, reload and health checks. Local encrypted backups and snapshots on your chosen WebDAV storage support recovery previews and selective connection imports.

### XTerminal / motty

[XTerminal](https://docs.xterminal.cn/) and [motty](https://github.com/t8y2/motty) also combine SSH, SFTP, remote desktops and AI; motty is Apache-2.0 open source with a native interface. TermQuay brings background multi-host tasks, result comparisons, multi-source logs and Docker tools into dedicated tabs that use existing SSH connections. Its [local CLI and Agent skill](#cli-and-agent-skill) let external agents query and run commands in explicitly selected, connected SSH workspaces.

<a id="cli-与-agent-skill"></a>
## CLI and Agent skill

The same executable opens the desktop without arguments. Run `termquay --help` for CLI usage. Enable **Settings → Local CLI** and unlock the desktop before accessing it. Use an exact connected SSH workspace ID for queries or command execution. Commands can modify remote systems; see the [CLI guide](docs/development.md#local-cli).

Install the [TermQuay Agent skill](skills/termquay/SKILL.md):

```sh
npx skills add Sanjeever/termquay --skill termquay -g
```

Omit `-g` for a project installation. Specify `--skill termquay` to avoid installing repository development skills. The skill does not install TermQuay; Node is needed for this installer, not for running the packaged desktop.

<a id="界面预览"></a>
## Screenshots

These screenshots show the English interface in browser [demo mode](docs/development.md#using-the-workbench).

![Connection center with groups, protocol filters and latency probes](docs/images/screenshots/connection-center-en.png)

![SSH terminal, remote files and Linux monitoring](docs/images/screenshots/ssh-workspace-en.png)

![Remote editor with encoding, line endings and minimap](docs/images/screenshots/remote-file-editor-en.png)

<a id="运行与开发"></a>
## Build and contribute

Start with [CONTRIBUTING.md](CONTRIBUTING.md). English and Chinese contributions are welcome; imperfect English is fine.

Follow [environment and first run](docs/development.md#environment) for toolchain definitions and dependency setup, then run from the repository root:

```sh
pnpm dev
```

The [development commands](docs/development.md#development-commands) cover the project-local Wails CLI, native builds, packaging, bindings and checks. The [architecture guide](docs/architecture.md) explains security, ownership, backpressure and recovery contracts.

<a id="项目结构与文档"></a>
## Repository map

Use the architecture guide's [code navigation](docs/architecture.md#code-navigation) for implementation and verification entry points. [AGENTS.md](AGENTS.md) defines contributor boundaries and documentation synchronization rules.

<a id="开源许可"></a>
## License

[Apache License 2.0](LICENSE). Original dependency licenses are in [build/licenses](build/licenses); provenance, review coverage and distribution gaps are tracked in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
