---
description: The hazard is concurrent agents corrupting a SHARED working tree via tree-wide git (stash/reset/checkout/clean), not editing itself. Give each editing agent its own worktree, or on a shared tree keep destructive git in one orchestrator. Born from a real incident where an agent's `git stash` did an internal reset --hard and wiped a shared tree.
scope: meta
source: [boards, votepol]
tags: [git, agents, orchestration, safety]
---

# Don't let parallel agents corrupt a shared working tree

Sub-agents **may write and edit code** — that's the point of delegating. The hazard
is **concurrent agents running tree-wide git against one shared working tree**:
those operations reset or replace the whole tree and silently wipe each other's
uncommitted work. The fix is to isolate the trees, or keep destructive git in one
place — not to forbid editing.

## The rule

- **Prefer isolation.** Give each agent that edits code its **own worktree or
  clone** (`git worktree add`, or a separate checkout). With no shared tree there is
  nothing to corrupt — the agent can edit, and even commit on its own branch, freely.
- **On a shared tree, keep tree-wide git out of the workers.** A sub-agent sharing
  the tree must never run `git stash`, `reset --hard`, `checkout`/`switch` (branches
  or paths), `clean`, or `restore` while others are working — these replace the whole
  tree. **Editing files is fine; wiping the tree is not.**
- **One orchestrator owns integration** — branch creation, staging, commits, and
  merging what the agents produced. Read-only `git log` / `diff` / `status` are
  always fine for any agent.

## Why (learned the hard way)

A prior wave of parallel agents used `git stash` to snapshot a baseline before each
measured a slice of the codebase. `git stash` performs an internal `reset --hard` on
the working tree — so agents running concurrently against one shared tree repeatedly
**wiped each other's uncommitted work.** The fix was structural: isolate the trees
(or take destructive git away from workers), not a bigger warning.

## How to structure it

- **Editing in parallel** — give each agent its own worktree/clone; agents commit on
  their own branch; the orchestrator merges the branches. No shared tree, no
  corruption.
- **Read-only fan-out on a shared tree** — if agents only analyse, they may share the
  tree, but then they measure and return findings/diffs **as text** for the
  orchestrator to apply. No git mutation in the workers.
- Either way, the orchestrator (or human) owns the final integrate/commit sequence.
