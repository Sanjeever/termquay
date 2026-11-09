# Contributing to TermQuay

[简体中文入口](README.zh-CN.md) · [Development](docs/development.md) · [Architecture](docs/architecture.md)

English and Chinese contributions are welcome. Imperfect English is fine. Maintainers can help polish wording and summarize Chinese discussions in English. You do not need to translate every document or rewrite all intermediate commits to contribute.

## Start a change

For a bug, include reproduction steps, expected/actual behavior, OS/WebView details and relevant redacted diagnostics. Discuss substantial features, public API changes or architecture changes before implementation. Never post passwords, keys, passphrases, tokens, unredacted terminal output or sensitive configuration.

Small fixes can go directly to a PR. Good entry points include translation proofreading, English layout fixes, accessibility labels, platform verification and focused reproductions. Say which platform/scenario you actually checked.

## Run from source

Follow [environment and first run](docs/development.md#first-run), including matching project-local Wails CLI and native dependencies. Use the Go/Wails v3, React/TypeScript, Vite, HeroUI, pnpm and Go Modules stack with its lockfile. Toolchain definitions live in the manifests.

Go owns network/authentication/session/transfer/storage logic; React owns views and drafts. Read [AGENTS.md](AGENTS.md) and the relevant [architecture contract](docs/architecture.md) before changing boundaries. Keep the diff focused and preserve user changes.

## Verify affected behavior

Follow [changes and checks](docs/development.md#changes-and-checks) for frontend commands, binding generation and backend/race checks. Choose checks for the affected behavior and inspect generated diffs. Never patch bindings manually.

Documentation-only changes need content/link/diff checks. Every PR need not test every platform or real service. Unit/local integration works without maintainer servers. Real SSH/WebDAV tests are optional, require authorization/secure settings and use isolated test directories or collections.

Distinguish unit/local integration, browser substitutes, native desktop and real remote checks. Report skipped tests/unavailable environments. Builds/test doubles do not establish real RDP, native WebView, IME or performance acceptance.

## Translate and document

Maintain bundled English/Simplified Chinese resources, whole sentences, plurals and interpolation parameters. Translate app-generated errors/status at display boundaries and retain original diagnostics. Verify language switching preserves sessions, transfers, drafts, editor selection and history. See [localization](docs/development.md#interface-localization).

Do not translate user content, commands, paths, terminal/remote output, model content, original licenses or published release notes. New documentation/comments default to English; retain Chinese entry points. Focused translation contributions are welcome without maintaining every language document; identify follow-up needs.

Follow the [documentation synchronization rules](AGENTS.md#documentation-consistency) after behavior/API/error/configuration changes, including help/examples and generated interfaces. Keep shared commands and verification records at their canonical entry points. Do not weaken identity, backpressure, cancellation or restore contracts to pass a test.

## Submit a pull request

Base changes on `main`. Use an English Conventional Commit description, such as `fix(files): preserve drafts after a save conflict`, and an English PR title. Explain the problem, resulting behavior, checks and remaining gaps. Exclude unrelated refactoring, upgrades and formatting.

Do not bump versions, edit historical logs, create tags, publish/sign artifacts, push on a maintainer's behalf or change remote settings without authorization. Future authorized release notes use English first, then Chinese in the same version file.

New production dependencies need compatibility review and the existing license/provenance workflow. Existing audit and platform gaps remain in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the development guide.
