# TermQuay contributor instructions

## Goals and sources of truth

TermQuay is an open source, cross-platform remote connection workbench. Keep its single-machine application architecture and unlimited connection catalog. Follow the [architecture constraints](docs/architecture.md#product-and-technology-boundaries) for runtime resource limits.

English is the primary language for public collaboration. New documentation, code comments, commit descriptions and PR titles should use English. Chinese feedback and contributions are welcome; maintainers can help with English wording and summarize Chinese discussions in English. Keep English and Simplified Chinese user interfaces and documentation entry points. Do not rewrite historical commits, release notes or unrelated comments to change their language.

Choose context relevant to the task:

| Subject | Source of truth |
| --- | --- |
| Behavior, APIs, configuration and defaults | Implementation, models, schemas and effective tests; generated bindings are derived artifacts |
| Toolchains, dependencies and build flags | `go.mod`, `frontend/package.json`, lockfiles, Taskfiles and active definitions in `build/` |
| Architecture, design intent and security contracts | [docs/architecture.md](docs/architecture.md), including subsystem code navigation |
| User entry points and development | [README.md](README.md), [docs/development.md](docs/development.md); keep them consistent with actual behavior |
| Distribution licensing and audit gaps | [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and original texts in `build/licenses/` |

## Implementation boundaries

- Keep Go, Wails v3, React, TypeScript, Vite, Tailwind CSS, HeroUI, pnpm and Go Modules. Check compatibility when upgrading dependencies; keep toolchain configuration local to this project.
- Go owns networking, authentication, sessions, transfers, collection, storage and backups. React owns views, interactions and editing drafts. Use standard libraries or established dependencies for protocols, encryption and mature file formats; do not replace application protocols with CLI subprocesses.
- Preserve end-to-end backpressure, channel isolation, lifecycle, identity verification, credential and recovery contracts. Distinguish intended capabilities from implemented ones.
- Read affected code and direct callers before editing. Make focused changes that solve the task completely. Avoid unrelated refactoring, formatting, dependency upgrades and speculative architecture.
- Preserve existing user changes. Read reference projects only when their paths are available; never modify them or inherit plaintext credential/backup designs.
- Expose real failures. Do not mask incomplete behavior with fake data, silent fallbacks, swallowed errors, retries, disabled identity verification or invented defaults.
- Follow the [release procedure](docs/development.md#versions-and-releases) for authorized version changes, platform resource synchronization and release logs.

## Code style and quality

- Write readable source. Keep independent statements on separate lines. Use conventional multiline blocks and JSX instead of manually compressed code.
- Follow the repository's Oxfmt and gofmt configuration. Format changed handwritten files before committing; `pnpm format` applies repository formatting. Preserve unrelated user changes.
- Run `pnpm format:check` before committing code changes. For frontend changes, also run `pnpm lint:frontend` and `pnpm check`, plus relevant tests.
- Use `pnpm verify` for aggregate verification when the change warrants it. Documentation-only changes follow the documentation verification rules.
- Keep formatter rules and lint checks enabled. Any local lint exception needs a concrete reason.
- Follow [the quality workflow](docs/development.md#linting-and-formatting) for command scope, prerequisites and browser checks.

## Documentation consistency

- Use [doc-writing](.agents/skills/doc-writing/SKILL.md) when creating, changing, or auditing documentation. Verify claims against current sources and behavior. Give each fact one authoritative home and link to it from other entry points.
- Review completed documentation with [prose-standard](.agents/skills/prose-standard/SKILL.md). Run [trim-cot-leakage](.agents/skills/trim-cot-leakage/SKILL.md) on formal documentation to remove authoring-session references while retaining rationale and evidence.
- In the same change as an API, event, error, configuration, default or behavior update, check affected README and guide sections in both languages, source comments, examples, CLI help and the distributed skill. Update affected text and check translations, tests and generated interfaces. Link to code, schemas or manifests for exact values. Summarize what changed or why the existing text still applies.
- Investigate conflicts between behavior and design contracts. Obtain confirmation before changing substantial contracts.

## Credentials and remote operations

- Never put passwords, private keys, passphrases, WebDAV credentials or test tokens in Git, documentation, screenshots, logs or snapshots. Use placeholders. Do not search other project configurations, shell history or entire environments for secrets.
- The user authorizes SSH MCP `sg1` when needed. Start with read-only identification through MCP. Verify application flows through the application's own protocol stack. If MCP is unavailable, use securely injected `SSH_MCP_SERVER_SG1_*` settings. Request secure configuration if missing; never guess or print credentials. See development documentation for test entry points.
- Treat `sg1` as a real server. Initial inspection is read-only. File verification must use and clean up a newly created `/tmp/termquay-*` directory. Do not change system, SSH, services, business files or keys, or install remote dependencies without separate authorization.
- Real WebDAV tests must use a securely configured, isolated test collection. Credentials may not persist between sessions. Continue independent work when resources are missing and report the real verification gap. Community contributions do not require maintainer-only servers.

## Interface conventions

- Outer tabs contain connection workspaces and independent tools such as multi-host operations and multi-source logs. Tool tabs do not own connections or belong to connection layouts or named working sets. SSH inner tabs represent terminals or remote files. Three columns can resize and collapse. The connection center manages groups and protocol filters; preserve workspace operating space.
- Keep a compact, restrained professional tool interface. Use layout, alignment and state to convey meaning. Preserve keyboard access and accessible names.
- Do not add marketing, decorative explanations, duplicate labels or unnecessary success dialogs. Show important errors at the operation site. Handle unsaved drafts and destructive actions explicitly.
- Bundle English and Simplified Chinese resources for offline use. Translate at display boundaries using stable keys/codes and parameters. Never translate user input, terminal output, remote files/logs, commands, paths, protocol fields, generated model content or third-party license texts.
- Language changes must preserve live connections, transfers, tasks, drafts, editor selection/history and workspace identity. Do not reload or remount the workbench to switch languages.

## Verification and delivery

- Run the smallest effective checks for affected behavior. Prioritize authentication failure, changed identity, lifecycle, backpressure, editing conflicts, transfer cancellation, backup corruption and recovery transactions. For documentation-only changes, check content, links and diff; do not run builds, type checks or tests.
- Distinguish unit tests, local integration, real SSH, real RDP and native desktop verification. Mocks, browser substitutes and cross-compilation do not prove native WebView or real remote behavior. Report unverified platforms.
- Support performance claims with environment and load evidence, covering the desktop application and WebView processes, input latency, memory and resource cleanup. Do not promise unmeasured numbers.
- Base work on `main`. Make small, reviewable local commits after relevant verification. Use Conventional Commits with English descriptions. Before committing, inspect the final diff, documentation impact and staged content for secrets, and explicitly stage task files. Never stage the local `handoff.md`.
- Authorization includes local commits. Pushing, releases, signing/distribution and remote settings require corresponding authorization. Report actual changes, commits, verification and limits. Meet the current phase's acceptance criteria before proceeding.
