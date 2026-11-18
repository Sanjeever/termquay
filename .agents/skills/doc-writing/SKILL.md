---
name: doc-writing
description: Plan, write, revise, and audit TermQuay documentation. Use to choose an audience and authoritative home, verify technical claims, and maintain navigation and bilingual entry points.
---

# Documentation workflow

Before drafting, read the relevant [contributor instructions](../../../AGENTS.md) and existing documents. Identify the reader, the decision or task the page serves, and what the reader needs to get started. Search the repository for competing definitions and incoming links. Give each fact one authoritative home. Other entry points can translate or summarize and link to it.

| Home | Responsibility |
| --- | --- |
| [README](../../../README.md) and its Chinese entry point | Product orientation, downloads, screenshots, and links to setup, usage, and contribution. |
| [CONTRIBUTING](../../../CONTRIBUTING.md), GitHub templates, and [AGENTS](../../../AGENTS.md) | Contributor workflow, review input, and agent instructions. |
| [Development and usage](../../../docs/development.md) and its Chinese counterpart | Setup, operating procedures, build and release commands, dated verification evidence, and unresolved gaps. Maintain shared commands and each detailed verification record once. Link to detail from the other language. |
| [Architecture](../../../docs/architecture.md) and its Chinese counterpart | Design constraints, invariants, tradeoffs, and a shared map to implementation and tests. |
| [Release notes](../../../docs/development.md#versions-and-releases) | Versioned changes in the form consumed by publishing and the updater. |
| [Third-party notices](../../../THIRD_PARTY_NOTICES.md) | License provenance, review scope, and distribution requirements. |
| [Distributed TermQuay skill](../../../skills/termquay/SKILL.md) | Standalone safety and usage instructions for an agent using an installed desktop. Discover version-specific CLI details through the installed executable's help. |
| Code, schemas, manifests, CLI help, and effective tests | Exact APIs, configuration, defaults, supported arguments, and behavior. Generated bindings derive from Go definitions. |

Draft from evidence. Read the implementation, direct callers, and effective test assertions for the claim. Use the relevant manifest or task definition for build and package commands. Check examples against the actual parser or entry point. Run safe, relevant examples when the environment and authorization permit, and state the limit of source inspection where runtime evidence is missing. Use placeholders for credentials and remote targets.

Distinguish observed behavior, required design, and open questions. Check history when intent is unclear. Correct stale descriptions of behavior and record violations of design constraints as discrepancies. For verification evidence, record the commit, environment, scope, result, and gaps. Identify test doubles and historical runs.

Use an existing section when it serves the reader. Link to the owning definition for mutable details. Update both language entry points for affected claims and links, while preserving their different levels of detail. When changing APIs, errors, or behavior, also check affected examples, CLI help, comments, the distributed skill, and generated interfaces. Keep published notes and original third-party materials intact.

Before delivery, verify commands, flags, configuration, examples, links, and heading anchors, including incoming references after a move. Check terminology, heading order, and fenced code language. Read the diff for duplicate ownership and use [prose-standard](../prose-standard/SKILL.md) and [trim-cot-leakage](../trim-cot-leakage/SKILL.md) to review the final text. Run the [documentation checks](../../../docs/development.md#documentation-checks).
