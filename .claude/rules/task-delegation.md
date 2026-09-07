---
description: Delegate to sub-agents when a task touches 5+ files OR is multi-step; name the skills/rules the sub-agent should read; use fan-out + adversarial-verify + synthesize for design and review.
scope: meta
source: [carbonhalo, boards]
tags: [agents, delegation, orchestration, process]
---

# Delegate to sub-agents

Delegating is the **default** for substantial work, not the exception. It keeps
the main context focused and lets independent work run in parallel.

## Decision rule

- **Delegate to a sub-agent** if the task requires reading **5+ files** OR is
  **multi-step**.
- **Do it directly** for a quick 1-2 file edit, a simple question, a build-error
  fix, or running a single command.

When in doubt on a larger task, delegate.

## Every delegated prompt must specify

1. **Requirements** — precisely what to produce and the acceptance criteria.
2. **Which skills/rules to read** — name them explicitly (e.g. "read the
   `error-handling` and `validation` rules, and the `adding-a-resource` recipe")
   so the sub-agent uses project patterns, not general knowledge.
3. **Expected return format** — a structured result the orchestrator can
   aggregate (a delete-list, a diff, a one-line status, a filled template).
4. **Context** — the files, package, and constraints it needs, and what is out of
   scope. Sub-agents must not run git (see the `agent-git-safety` rule).

## Run independent work in parallel

Launch independent sub-agents concurrently (in a single batch) when their tasks
don't depend on each other — e.g. one per file for a mechanical refactor, or one
per sub-area of a design.

## Fan-out + adversarial-verify + synthesize (design & review)

For large, risky design or review work, use this three-phase pattern:

1. **Fan-out** — split the problem into independent sub-areas; explore each with
   its own sub-agent, in parallel.
2. **Adversarially verify** — have a separate agent challenge each sub-area's
   output (find the flaws, the missed cases, the wrong assumptions) rather than
   trusting the first pass.
3. **Synthesize** — merge the verified pieces into one coherent plan/review, then
   re-scope as a whole.

This produces more robust designs than a single linear pass and makes the work
reviewable.
