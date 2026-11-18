---
name: prose-standard
description: Review TermQuay engineering prose for accuracy, clarity, information density, and complete behavioral contracts. Use after drafting or revising technical documentation, or for an editorial review.
---

# Engineering prose

Write what the reader needs to know, decide, or do. Name the actor, action, and object. Favor active verbs and precise terms from the product, protocol, or code. Give each sentence a main point and each paragraph a purpose. Use as many words as the contract requires.

- Remove stock introductions, transitions, repeated conclusions, and adjectives that supply no evidence. Keep a statement if it adds a fact, rationale, constraint, or instruction.
- Preserve obligation strength (`must`, `should`, `may`), scope, prerequisites, ordering, ownership, effects, and failures. Keep intentional exceptions and limits on the evidence. An observed Chromium result never implies native WebView support.
- Use distinct names for a saved connection, workspace, SSH instance, and terminal. Keep user-facing labels aligned with the locale resources. Use literal spelling for commands, fields, paths, and error codes.
- Link to code or configuration for exact limits and defaults. Explain consequences, invariants, or tradeoffs a reader cannot infer from a declaration or a short implementation. Support comparative and performance claims with measurements and their conditions.

Compare the edit with the original for changed meaning. For example, “Cancel stops the command” loses the unknown remote outcome. “Cancel ends the local wait. Verify remote state before running the command again” preserves the distinction when the implementation only controls local cancellation.

Preserve the author's voice and rhythm in essays, commentary, and narrative. Apply factual corrections in those genres without imposing the style of a reference manual. Preserve published release notes, imported material, and original license texts.

Use [doc-writing](../doc-writing/SKILL.md) for evidence and placement and [trim-cot-leakage](../trim-cot-leakage/SKILL.md) for references to the authoring process.
