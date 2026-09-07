---
name: plan
description: Use before starting any non-trivial (multi-step or multi-file) piece of work. Writes a dated implementation plan to docs/plans/ and keeps it updated with what actually happened as steps complete.
---

# Plan

For any non-trivial change, write an implementation plan **before** coding, commit
it to the repo, and update it as you go. A plan is a living, reviewable artefact —
the next agent (or human) reads it to understand intent, order, and what was
deferred.

## Where

```
docs/plans/YYYY-MM-DD-<slug>.md
```

Use today's date and a short kebab-case slug, e.g.
`docs/plans/2026-07-02-csv-export.md`.

## Structure

Write these sections:

1. **Context** — the problem, the goal, and links to any issue/task, design, or
   related plans. Note what is explicitly out of scope.
2. **Architecture** — how it fits together, with an **ASCII diagram** of the
   moving parts and data flow:

   ```
   ┌────────┐   request   ┌─────────┐   query   ┌──────────┐
   │ client │ ──────────▶ │  API    │ ────────▶ │  store   │
   └────────┘             └─────────┘           └──────────┘
   ```

3. **Key interfaces** — the important types, function signatures, schemas, or
   endpoints, with short code blocks. Enough that someone could start coding.
4. **Implementation Order** — a **checkboxed** list of steps in the order they
   should be done, with dependencies noted:

   ```
   - [ ] 1. Add the input schema and inferred types
   - [ ] 2. Implement the service (depends on 1)
   - [ ] 3. Wire the route + validation
   - [ ] 4. Add tests
   ```

5. **Verification** — the exact commands to prove it works (lint, typecheck,
   tests, a manual check).
6. **Notes / Deferred** — decisions made, alternatives rejected (and why), and
   anything intentionally deferred to a later change.

## Keep it honest as you work

- Tick each step off as you complete it (`- [ ]` → `- [x]`).
- When reality diverges from the plan, **annotate the step in place** rather than
  silently rewriting it — record what actually happened vs the intent:

  ```
  - [x] 2. Implement the service
    _deviation: split into two services once the tenant-scoping got its own
    concern; original single-service design didn't compose with the mapper._
  ```

- If a design decision changes mid-flight, add it to **Notes** with the reason.
  A plan that records its own drift is trustworthy; one that pretends it went to
  plan is not.
