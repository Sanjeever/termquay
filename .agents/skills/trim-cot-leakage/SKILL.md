---
name: trim-cot-leakage
description: Find and remove authoring-session residue from formal TermQuay documentation while preserving technical facts, design rationale, and verification evidence.
---

# Remove authoring-session residue

Read from the perspective of someone with the repository and its cited sources. Each reference should resolve and each technical claim should stand on its evidence without a chat transcript, PR discussion, or unpublished draft.

1. Read the affected sections in context. Look for PR announcements, references to earlier discussion, reviewer-facing defenses, draft phases and TODOs, speculative intent, temporary notes, repeated summaries, and step-by-step narration of code. Phrases such as “this PR introduces” or “based on our investigation” are review cues. Judge their role in the passage.
2. Identify the useful facts before editing. Verify each one and preserve the constraints and qualifiers in [prose-standard](../prose-standard/SKILL.md). Replace a process account with the resulting behavior and durable rationale. Replace a reference to a draft with a committed source where one exists. Remove prose that carries no independent information.
3. Keep unanswered questions separate from current behavior. Preserve ambiguous design claims for maintainers to resolve. Record unresolved discrepancies in the development guide with the trigger, expected and observed behavior, evidence, and missing verification, or link to an existing issue that owns the follow-up.
4. Reread the result against its sources and check links. Confirm that the edit neither extends a guarantee nor deletes a reason someone needs to maintain it.

For example, “We chose staging during review because the SFTP client sets permissions after creation” becomes “Create the file in a private staging directory. The SFTP client applies file permissions after creation, so creating it in a shared directory would expose it first.” Check the [remote-file contract](../../../docs/architecture.md#remote-files-and-monitoring) before editing that rationale.

Keep real operating procedures, security rationale, useful issue references, compatibility and migration history, and observations tied to dated verification. Historical and narrative genres can refer to past work as part of their subject. Preserve published release notes, upstream text, licenses, and recorded fixtures. Use search as an aid to reading. Leave editorial judgments out of CI.
