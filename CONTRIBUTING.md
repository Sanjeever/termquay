# Contributing to TermQuay

[简体中文入口](README.zh-CN.md) · [Development](docs/development.md) · [Architecture](docs/architecture.md)

English and Chinese contributions are welcome. Imperfect English is fine. Maintainers can help polish wording and summarize Chinese discussions in English. You do not need to translate every document or rewrite all intermediate commits to contribute.

## Start a change

For a bug, include reproduction steps, expected/actual behavior, OS/WebView details and relevant redacted diagnostics. Discuss substantial features, public API changes or architecture changes before implementation. Never post passwords, keys, passphrases, tokens, unredacted terminal output or sensitive configuration.

Small fixes can go directly to a PR. Good entry points include translation proofreading, English layout fixes, accessibility labels, platform verification and focused reproductions. Say which platform/scenario you actually checked.

## Run from source

Follow [First run](docs/development.md#first-run) for prerequisites and startup. Read [AGENTS.md](AGENTS.md) and the relevant [architecture contract](docs/architecture.md) before changing application boundaries.

## Verify affected behavior

Choose [checks](docs/development.md#changes-and-checks) for the affected behavior. Report which checks ran, their environments, and any skips or gaps. Identify local integration, browser substitutes, native desktop and real remote checks separately. Run [real-service tests](docs/development.md#optional-real-services) on targets you are authorized to use, with securely injected settings.

## Translate and document

Follow the [localization guide](docs/development.md#interface-localization) for interface translations and the [documentation workflow](AGENTS.md#documentation-consistency) for prose and changes to behavior, APIs, errors or configuration. Focused translation contributions are welcome. Identify any affected counterpart that still needs an update.

## Submit a pull request

Base changes on `main`. Use an English Conventional Commit description, such as `fix(files): preserve drafts after a save conflict`, and an English PR title. Explain the problem, resulting behavior, checks and remaining gaps. Exclude unrelated refactoring, upgrades and formatting.

Follow the [release procedure](docs/development.md#versions-and-releases) for authorized version and publication work. Preserve published notes and original third-party licenses.

New production dependencies need compatibility review and the existing license/provenance workflow. Existing audit and platform gaps remain in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the development guide.
