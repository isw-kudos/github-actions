---
description: Non-trivial work gets a dated implementation plan in docs/plans/ with checkboxed step order; annotate each completed step with what actually happened vs intent. Plans are living documents.
scope: meta
source: [collab, boards, irt-flight-manager]
tags: [planning, docs, process]
---

# Plan before you build

For any non-trivial (multi-step or multi-file) change, write a plan **before**
coding and commit it to the repo. See the `plan` skill for the full template;
this rule is the always-on expectation.

## Where plans live

- Dated markdown: `docs/plans/YYYY-MM-DD-<slug>.md`.
- Committed and reviewable — a plan is an artefact, not a scratchpad. The next
  agent or reviewer reads it to understand intent, ordering, and what was deferred.

## What a plan contains

- **Context** — problem, goal, links, and what is out of scope.
- **Architecture** — how it fits together, ideally with an ASCII diagram.
- **Key interfaces** — the important types/signatures/schemas/endpoints.
- **Implementation Order** — a **checkboxed** step list in dependency order.
- **Verification** — the exact commands that prove it works.
- **Notes / Deferred** — decisions, rejected alternatives (with why), deferrals.

## Plans are living documents

- Tick steps off as you complete them (`- [ ]` → `- [x]`).
- When work diverges from the plan, **annotate the step in place** — record what
  actually happened vs the original intent, don't silently rewrite history:

  ```
  - [x] 12. Migrate the proof-of-concept components
    _deviation: the single component was replaced by two; the shared one uses the
    lower-level API directly since it can't depend on the per-app helper._
  ```

- Record consciously-rejected alternatives so future readers don't relitigate
  them. Capturing "we changed our mind, here's why, here's what's deferred" is
  the point — a plan that shows its drift is trustworthy; stale intent is not.
