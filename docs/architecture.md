# Architecture and behavioral contracts

[简体中文](architecture.zh-CN.md) · [Development](development.md) · [Contributing](../CONTRIBUTING.md)

These are design invariants, not a claim that every capability has passed acceptance. Implementation, models and effective tests define current behavior. Investigate divergence instead of silently rewriting a contract to excuse a defect. The [Chinese document](architecture.zh-CN.md) retains longer design rationale; the shared [code map](#code-navigation) below points to implementation and verification entry points.

<a id="产品与技术边界"></a>
## Product and technology boundaries

Keep a single-machine Go/Wails desktop application. React owns views, interactions and drafts; Go owns networking, authentication, sessions, transfers, collection, storage and backups. Do not introduce accounts, a cloud control plane, distributed services, a general plugin framework or team synchronization without an established need and authorization.

Saved connections have no commercial count limit. Runtime sessions, tasks, frames, buffers and queues still require bounds. The ordinary SSH directory tree is an explicit exception below, not an exemption for scans or queues. Dependencies and compatible combinations come from [go.mod](../go.mod), [frontend/package.json](../frontend/package.json) and lockfiles. Reuse mature protocols, cryptography, SQLite and file-format implementations; CodeMirror is a configuration editor, not an IDE service.

The fixed connection center manages groups and connection operations. Outer tabs contain connection workspaces or independent multi-host/log/Docker tools. Tools reference existing SSH connections without owning them and do not enter connection layouts/working sets. SSH inner tabs represent independent terminals or files. Persistent configuration, live owners and local layout are distinct: restoring layout does not restore a remote shell or replay input.

Local terminals use Go-owned PTYs/processes and terminal consumption acknowledgements. Layout restoration must not automatically start them. Docker uses its HTTP API through a verified SSH-forwarded Unix socket without Docker CLI subprocesses or installed agents. Bound API responses, frames, entries, concurrency and timeouts. Container terminals do not use host filesystem completion. Confirm actual host/container identities before state changes, without automatic retry/elevation.

Image preview is validated in Go with bounded bytes, pixels, tasks and resources. Short-lived credentials bind resources to the SSH owner and travel in headers, not URLs. Hidden/closed views release resources; owner closure cancels reads. External images require explicit loading, receive no SSH credentials and do not become executable HTML. Preview content is excluded from text drafts/backups.

Demo mode uses isolated frontend memory and does not create real connections, PTYs, collection subscriptions or configuration/file/backup writes. Real workspaces remain mounted and hidden. Demo appearance is temporary; demo results do not prove remote integration.

## Localization and collaboration

English is the public collaboration default; Chinese contributions are welcome. Bundle English and Simplified Chinese resources offline and initialize before business storage unlock. Preserve the actual `auto` preference for migration.

Translate app-generated labels/messages at display boundaries using stable keys/codes and parameters. Preserve original diagnostics, error chains, file recovery codes, SSH steps and legacy machine fields. [Diagnostic metadata](../internal/message/error.go) has no language state or translation dependencies. Native menu/dialog labels belong in the application layer.

Do not translate user names, commands, paths, terminal output, remote file/log bodies, model-generated content or original licenses. Language switching must retain workspace/connection identity, PTYs, RDP, transfers, runs, drafts and editor content/selection/history. Update providers, formatting, sorting and component dictionaries; reconfigure editors rather than remounting/reloading the workbench.

<a id="通信背压与生命周期"></a>
## Communication, backpressure and lifecycle

- Wails bindings handle controls, events carry low-frequency state and ordered bounded Streams carry terminal bytes. Generate interfaces from Go rather than maintaining duplicate definitions.
- Bounded queues alone are insufficient. Acknowledge consumed bytes from xterm's parsing completion callback; upstream continues against acknowledgements. Output pressure must not block independent input or silently discard unparsed bytes.
- A workspace may share an SSH connection, but each terminal owns its PTY. SFTP, monitoring and background commands use independent channels. Closing one terminal must not close its workspace connection.
- Every owner has a close path. Cancellation, disconnect, workspace closure, frontend destruction and exit release associated channels, goroutines, subscriptions and instances. Switching tabs/settings preserves owners; hiding transfers does not cancel them.
- Multi-host runs belong to Go after the initiating request completes. Hiding the view does not cancel a run or approve its first-host gate. Events/snapshots use revisions; explicitly saved results are encrypted locally and excluded from normal backups. Restoring history never resumes/replays execution.
- Explicitly enabled shell hooks verify a random session ID, buffer snapshot and cursor before completion edits. Frames are bounded and removed from recording. Completion never executes/replays commands, and path access needs confirmed filesystem correspondence rather than reusing host paths inside containers/nested SSH.
- Session command history stores bounded metadata/live markers, not output archives. Unknown command text or exit status remains unknown. Closing a terminal clears it; snippet saving is separate and explicit.
- Recording is explicit local output archival with byte/event limits. Failure stops archival visibly while interactive output continues. Playback is isolated from network execution; validate format/events/dimensions and release resources on close.
- Pending channel-open requests retain their slots until the underlying operation ends, even after local cancellation. Do not close a shared connection to cancel one independent command.

Workspace IDs, SSH instances and PTY IDs are distinct. Reconnect replaces owners explicitly without reusing old Streams/PTys/input. Keep bounded old buffers and recheck draft baselines before saving. Dirty protection belongs to the registered UI workspace even while disconnected; late callbacks cannot resurrect a closed workspace. Pane moves/merge/maximize must retain editor/terminal instances.

Normal exit coordinates unsaved files, local state, transfer cancellation/resume records and AI persistence before closing storage. Cancellation/timeout does not prove a remote process stopped. Resumable single-file transfers bind destination, user, actual host fingerprint and jump route; reauthenticate and verify source/destination versions plus staging length before explicit continuation. Encrypted resume records stay outside regular backups. Normal exit retains staging tied to saved records; session storage/unsaved records do not guarantee restart recovery. Remote private staging may remain and requires the same verified route for cleanup.

Removing finished transfer records is a local operation. After confirmation for retained staging, it deletes the associated resume data and leaves staging files untouched. Explicit staging cleanup deletes the files before removing the record; already absent files count as cleaned up, while connection, permission and other failures preserve the record for retry. See [record removal](../internal/app/transfer.go) and [staging cleanup](../internal/app/transfer_resume.go).

Latency is runtime TCP connection time along the saved proxy/jump route, including DNS, not terminal/desktop input latency. Probes do not decrypt credentials or authenticate targets. Unavailable jumps remain unknown instead of falling back to direct connections. Scheduling follows the visible filtered catalog/window and merges requests without restarting on sort. RDP graphical queues/WASM memory need their own real-load evidence; SSH backpressure tests do not establish equivalent RDP guarantees.

<a id="身份凭据与本地数据"></a>
## Identity, credentials and local data

SQLite stores business data. Credential fields use AEAD with a random master key protected by the system vault; connection names/addresses remain unencrypted metadata. Keep the key outside the database and reject unknown future database versions rather than replacing them with an empty database.

Vault failure requires an explicit choice, never plaintext persistence. Session storage uses a temporary database and in-process random key, cleans on normal exit and does not guarantee restart recovery. Master password storage wraps the same key using age scrypt, with bounded key file/body/KDF work. An existing password file requires unlock and cannot fall back to the vault. Creating storage must not overwrite existing data. Protection switches verify the same key, stage/sync/replace privately and remove the old vault copy after success.

Application lock blocks new interaction and terminal input while existing sessions, transfers, runs and tunnels can continue. It does not clear the in-process key. Forgotten passwords/corrupt key files require an independent encrypted backup.

Catalog/reference APIs expose safe metadata without decrypting secrets. A dedicated password form can retrieve a saved password for refill/explicit reveal; private keys are not returned to React. RDP WASM receives necessary authentication material during creation, outside global React state, logs and persistence. Releasing references does not guarantee immediate erasure of every Go/JS/WASM plaintext copy.

Shared credential updates review/recheck the full reference set in one transaction. Editing a single connection's secret separates its credential; copying a connection creates independent encrypted credentials. Connection identity is a stable ID, not just an address.

First SSH identity requires explicit fingerprint verification; known changes block connection. RDP can pass system CA/hostname validation, otherwise require fingerprint confirmation. Expired/not-yet-valid certificates cannot be manually accepted. Pin both trust paths and block later changes. Legitimate trust updates reprobe and check original record, generation and expiry before committing.

SSH trust is keyed by destination, port and the immediate saved jump ID, as established by the [multi-hop design](development.zh-CN.md#连接与工作区) and [trust-key implementation](../internal/app/ssh_connect.go). RDP gateway trust additionally binds the SSH target and chain identity through its [gateway scope](../internal/app/rdp_gateway.go). Explicit `known_hosts` imports use bounded candidates/preview without DNS inference; revoked keys are not trusted and CA entries are not ordinary host fingerprints. Preserve negotiated identity for sessions/resume records. Revocation invalidates stale requests/unused RDP grants while established sessions can continue. Trust stays on the destination device and is excluded from normal backups.

<a id="远端文件与监控"></a>
## Remote files and monitoring

Saving ordinary/sudo files rechecks original remote bytes/attributes. With history enabled, an encrypted version/index commits locally before remote writing; history failure blocks the write. Scope/bound history by actual destination, user, route identity and path, outside normal backups. Loading history changes a draft, not the live file. Validation/reload/health checks are explicit, with reload separately confirmed.

Ordinary SFTP saves use a private staging directory on the same filesystem, preserve reported POSIX mode/UID/GID and publish using server POSIX rename. Reject special permission bits on the file. [Staging](../internal/files/staging.go) rejects group/other-writable parents unless they have the sticky bit. SFTP checks and rename are not atomic compare-and-swap against external writers. This path does not preserve ACLs/xattrs, and failures may leave staging. Do not describe saving as lossless or conflict-free.

The current SFTP client's file-creation API cannot set permissions at creation time. Restricting the staging directory before writing protects content until final attributes are applied; creating a file directly in a shared directory and changing its permissions afterward would leave an exposure window.

Bound raw bytes, decoded text and encoded output. Use encoding libraries and preserve BOM/line endings as draft format; reject invalid bytes/unrepresentable characters instead of replacement. Normalize mixed line endings explicitly. SFTP uses POSIX paths; identified Windows AI file queries convert drive-letter absolute paths at their boundary. Never concatenate filenames into shell commands. Refresh/errors must not overwrite drafts.

sudo uses separately authorized bounded exec channels, never the interactive terminal/elevated SFTP. Passwordless sudo sends no password. Escape paths/version arguments, support ordinary Linux files with existing sudo/coreutils and do not change remote policy or persist sudo passwords. [sudo saving](../internal/app/sudo_files.go) uses private staging and requests mode/ownership/xattr preservation through GNU coreutils; it rejects group/other-writable parents even with the sticky bit. Its version checks and replacement also retain a race with external writers.

Sync/cross-workspace directory copy previews bounded differences and explicitly executes selected entries. It does not remove extra destination files or recurse through symlinks. Bind both owners, reject overlapping same-target roots, stream through the local machine and recheck versions before publication. Failure reports partial completion and requires a new preview; no cross-host transaction or directory resume is promised.

The ordinary SSH directory tree deliberately has no hard per-directory entry/byte cap and can accumulate a full directory with SFTP v1. Memory grows with names/entries; read concurrency/expanded directory count remain bounded. This exception does not extend to paired browsers, recursive search, sync, transfers or queues. Bounded scans use upstream SFTP v2 paging, currently a prerelease, with packet/in-flight limits. Preserve cancellation/close/real-server regressions and reevaluate when upstream changes.

Symlink directory browsing retains logical node identity and displays raw/resolved targets with ancestor-cycle blocking. Rename/delete acts on the link itself. Recursive deletion scans bounded scope, rechecks directory chains/types and reports partial deletion; it is not an atomic transaction against concurrent changes.

Linux monitoring uses independent bounded exec channels, sending scripts over stdin without installing agents/scripts. Compute rates from counter/time differences. First samples, resets, missing/failing/stale metrics remain unknown/errors rather than zero/realtime values. Filesystem capacity uses existing util-linux `findmnt` JSON and fails separately without automatic installation/text-parser fallback.

Process/systemd/port/Docker queries use current-user capabilities and bounded outputs/deadlines. Confirm host/unit/container before state changes. Cancellation does not undo those changes; verify state before retrying. Diagnostic snapshots are explicit partial/time-stamped collections, optionally encrypted locally or selectively exported after review, not atomic system snapshots or normal backups.

Multi-source logs bind actual SSH instances, own no connections and do not automatically rebind after disconnect. Keep bounded caches, one request per source, and stop failed polling until explicit refresh. Filtering/JSON formatting runs in deadline-limited Workers. Hidden/minimized/locked views stop reading/processing; close releases caches. Preserve sources/times, truncation and partial results without promising complete archives or synchronized clocks.

<a id="内嵌-rdp"></a>
## Embedded RDP

IronRDP WASM handles protocol/rendering; Go supplies an RDCleanPath bridge because WebViews cannot make raw TCP/TLS connections. A generic WebSocket/TCP proxy is insufficient. Listen on loopback, validate exact origins and short-lived one-use grants bound to backend-selected destinations. Do not expose an arbitrary target proxy or downgrade TLS/NLA.

SSH gateways bind a concrete owner, preserve the original RDP destination/TLS hostname and isolate trust by route identity. Closing/reconnecting the owner disconnects the desktop, without direct fallback. Development origins must match the actual loopback frontend port; redact session path tokens from technical details.

The bridge currently pins TLS 1.2. A tested Windows 11 target returned `internal_error` after Go TLS 1.3 handshake and before authentication data; TLS 1.2 worked with the same certificate/account/components. This interoperability boundary is not evidence of a wrong password. TLS 1.3-only targets are unsupported. Changing it requires real handshake/NLA/display/input evidence while retaining certificate validity and identity-change rejection.

Ship the verified JS/component/WASM combination. WASM initialization, local TLS bridging and real desktops are different verification layers. Clipboard defaults off per session. Native focus/IME/clipboard/sizing/concurrency require platform evidence. Respect the patched clipboard-ready signal rather than a fixed delay.

Windows mstsc owns authentication, identity/resource confirmation and remote lifecycle; process launch is not remote connection success. Credentials travel in a current-user DPAPI-encrypted temporary configuration restricted to that user and SYSTEM, not command arguments or Credential Manager. Early/abnormal app exit may leave a configuration decryptable by that user. Preserve Windows confirmations and do not claim the app observes mstsc remote success.

<a id="加密备份与恢复"></a>
## Encrypted backup and recovery

Export a consistent versioned snapshot encrypted by age; plaintext must not reach temporary files. Include only selected credentials/settings. Device name/inclusion flags are encrypted; legacy missing flags remain unknown. Unlock material is independent of the source vault so another device can decrypt.

Password-only backups retain `.json.age`. Recovery-key backups use bounded ZIP Store `.tqbackup` containers with a per-backup age X25519 identity separately wrapped by password scrypt and recovery public key. Do not mix unsupported recipient modes. Reject unknown/duplicate/compressed/oversized entries and versions; verify ciphertext integrity. Keep private recovery keys offline and only their public keys locally. Changed keys/passwords affect new backups; old backups require original unlock material.

WebDAV snapshots are append-only. Upload temporary ciphertext, then publish with a single `MOVE` using `Overwrite: F`; headers alone do not prove provider collision rejection. Do not overwrite/retry recursively. Explicit pruning previews a fixed set, retains at least one snapshot, excludes unknown files/staging and rechecks location/retention/version. Strong ETags support conditional deletion; otherwise a check/delete race remains. Report partial/unknown outcomes without automatic retry.

Restore decrypts, validates versions/references, previews and commits the same data. Reject stale previews/changed local settings. Full replacement first saves an encrypted persistent safety copy in `restore-backups`; failure blocks replacement, including session mode. Reencrypt credentials/settings using the destination key in one transaction, without partial overwrite.

Full replacement replaces credentials even if the snapshot contains none. Selective import allocates new IDs for selected connections, required jumps/groups/credentials and maps preset/working-set references without altering existing identities. Follow the explicit [selection model](../internal/app/backup_selection.go)/whitelist. Keep local trust, WebDAV credentials and drafts. Recent connections do not migrate. Imported private-key paths stay disabled until reselected; verify sync paths and pause restored tunnel auto-start.

Automatic backup serializes/coalesces bounded pending work. Monitoring/progress/recent timestamps must not cause backup loops. Fail visibly without unbounded retry. Application, database, container, snapshot and layout versions are independent. Old formats stay readable under their contracts; unknown future versions are rejected.

<a id="内置-ai-助手"></a>
## AI ownership and approvals

Encrypted model configuration is independent of CLI authorization. Do not echo saved API keys; distinguish keep/replace/clear. Users provide complete URL/protocol. Do not retry/follow redirects automatically. Bound connection/header waits, total request time, SSE bytes/events, text, arguments, history and concurrent runs.

Preserve protocol continuation, tool/result associations, thinking signatures and encrypted reasoning. Responses requests are stateless. Provider tools do not become app tools; execute only after complete valid protocol state. Invalid/truncated arguments block execution. Per-response call/block limits in [protocol bounds](../internal/ai/types.go) protect parsing and allocation; they are separate from turn execution budgets. Context pagination and recovery must retain complete batches.

The Go agent binds to a real SSH owner; tool arguments cannot select another workspace or fall back locally. Probe capabilities rather than assuming Linux. AI supports independent POSIX sh/Windows PowerShell; CLI/multi-host retain `sh -s`. Preserve stdout/stderr, exit status, truncation and bounded raw bytes on decoding failure. Unknown execution blocks replay.

Backend approvals are one-use and bound to full arguments, timeout, turn and session; show the actual interpreter. Rejection, stopping, disabling AI, locking, owner replacement/disconnect and exit invalidate pending approval. Output instructions, history or summaries cannot grant permission. In-flight turns retain their configuration snapshot.

Turns have no fixed cumulative tool-call cap. Runtime budgets cover model/compaction/tools and pause only during explicit approval waiting, then resume their remaining allowance. Reserve part of that same budget for one text-only final summary: stop starting tools, record unexecuted calls, disable model tool choice and reject unexpected calls during summarization. The reserve does not extend the hard runtime limit or bypass stop, lock, disconnect or exit. Request/network/protocol/storage failures remain failures, without automatic retry. Budget definitions live in [the agent](../internal/app/ai.go).

Detect repeated failed tools using a bounded recent history of tool names, normalized arguments and result fingerprints. Repeated identical failure cycles stop further tools and enter text-only summarization. Successful calls and unknown remote execution reset this history; successful polling and advancing pagination are not failures. This guard does not prove semantic progress or detect every loop. Thresholds live in [the run loop](../internal/app/ai_runs.go).

Hiding preserves a running turn. Exit waits for encrypted persistence; deleting/new conversation cancels and waits so background work cannot recreate history. Encrypt history/target snapshots/summaries with session/message-bound AAD. Separate complete local records from model context and compact only whole tool-round-trip boundaries. Configuration/history stay outside regular backups.

<a id="本机-cli-访问"></a>
## Local CLI boundary

The CLI is a short-lived same-user client; the desktop owns credentials, sessions and storage. Use explicit IPC allowlists rather than reflecting Wails methods; do not open network ports. Windows pipes restrict the current SID/reject remote clients; Unix validates owner/permissions and exclusive endpoint locking before stale cleanup. This boundary does not defend an already-compromised OS user.

Access defaults off. Require desktop unlock/configuration rather than IPC credential prompts or direct database/vault access. Minimal disabled/locked status does not disclose locked authorization. Saved connections are safe metadata; execution uses exact live SSH owner IDs.

Bound bytes/concurrency/deadlines/pending opens. Queries reuse read contracts without becoming uploads, state changes or task starts. Preserve errors, versions, pagination revisions and truncation without invalid JSON. Disabling/locking blocks new operations; admitted ones retain cancellation/deadline/owner constraints. Cancellation never authorizes replay of unknown-state commands.

<a id="发布与应用更新"></a>
## Releases and updates

The [release guide](development.md#versions-and-releases) defines application versions and future bilingual logs. Authorized public tags point to checked commits already in `main`; publish after all target artifacts are ready and never overwrite public releases.

Use the pinned Wails updater for download/checksum/unpack/replacement. Accept matching project stable-platform artifacts, require checksums and block invalid downloads. Integrity checksums are distinct from signing/authenticity. Serialize checks/downloads, cancel/wait on close, and do not auto-install in development. User confirmation, unsaved files and local persistence precede restart/helper handoff. The framework owns handed-off staging; parent exit must not delete it. Preserve app identity/data paths. Binary recovery is not data migration rollback.

<a id="按概念定位代码"></a>
## Code navigation

Use these entries to select task context, rather than treating file names as a fixed architecture. Detailed check commands and platform evidence belong in the [development guide](development.md#changes-and-checks).

| Concept | Source | Verification |
| --- | --- | --- |
| Program/assets/build | [entry point](../main.go), [embedded assets and build identity](../assets.go), [root commands](../package.json), [tasks](../Taskfile.yml), [platform resources](../build), [CI/release workflows](../.github/workflows) | [Development commands](development.md#development-commands), [release checks](development.md#versions-and-releases) |
| Frontend/service boundary | [React workbench](../frontend/src/App.tsx), [Go application services](../internal/app), [generated bindings](../frontend/bindings) | [Regenerate bindings and inspect changes](development.md#changes-and-checks); do not edit generated interfaces manually |
| Workspaces/layout/exit | [lifecycle](../internal/app/lifecycle.go), [layout](../internal/app/workspace.go), [drafts](../internal/app/workspace_state.go), [frontend workspaces](../frontend/src/features/workspaces) | Lifecycle/layout/draft tests; native close/restart |
| Releases/updates | [build identity](../assets.go), [updates](../internal/app/update.go), [provider](../internal/update), [version tool](../scripts/version.mjs) | Provider/script tests; native replacement/restart |
| SSH/PTY/backpressure | [SSH](../internal/ssh), [connection service](../internal/app/ssh_connect.go), [terminal view](../frontend/src/features/terminal/TerminalView.tsx) | Local protocol tests; [real SSH and reconnect gaps](development.zh-CN.md#重连修复与验证缺口) |
| Local terminals | [PTY service](../internal/app/local_terminal.go), [terminal view](../frontend/src/features/terminal/TerminalView.tsx) | Native process/input/close checks per platform |
| Catalog latency | [scheduler](../frontend/src/features/connections/useConnectionLatency.ts), [service](../internal/app/latency.go), [probe](../internal/ssh/latency.go) | Latency tests; real proxy/jump routes and view visibility |
| Storage/credentials/trust | [store](../internal/store), [storage](../internal/app/storage.go), [credentials](../internal/app/credentials.go), [trust](../internal/app/trust.go) | Vault, credential and identity tests |
| Configuration import | [OpenSSH](../internal/app/import.go), [other clients](../internal/app/import_sessions.go), [PuTTY registry](../internal/app/import_putty_windows.go) | Import fixtures; real client exports/native pickers |
| Files/transfers | [files](../internal/files), [transfer service](../internal/app/transfer.go), [frontend files](../frontend/src/features/files) | SFTP fixtures, conflict/cancel/resume/removal tests; native dialogs |
| Monitoring/logs | [monitor](../internal/monitor), [inspection](../internal/app/linux_inspection.go), [logs](../frontend/src/features/logs) | Parser/history tests; real Linux permissions and visibility |
| Docker | [client](../internal/docker), [service](../internal/app/docker.go), [workspace](../frontend/src/features/docker) | Frame/lifecycle/preference tests; real SSH socket/container checks |
| RDP | [bridge](../internal/rdp), [RDP service](../internal/app/rdp.go), [system client](../internal/app/system_rdp_windows.go) | Local TLS tests; real desktop/native WebView |
| AI | [protocols](../internal/ai), [agent](../internal/app/ai.go), [tools](../internal/app/ai_tools.go), [history](../internal/store/ai.go) | Protocol/approval/budget/history tests; [provider and platform gaps](development.md#verification-and-known-gaps) |
| CLI/IPC | [CLI](../internal/cli), [IPC](../internal/localapi), [queries](../internal/app/cli_queries.go) | Authorization/query/cancellation tests; [native executable smoke](../scripts/cli-smoke.mjs) |
| Backups | [backup](../internal/backup), [restore](../internal/app/backup_restore.go), [selection](../internal/app/backup_selection.go) | Corruption, validation, safety copy and transaction tests; real WebDAV/migration |
