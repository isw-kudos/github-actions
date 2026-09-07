---
description: Documentation taxonomy — what belongs in .claude/rules vs docs/ vs code comments; keep rule files small and single-topic; one canonical source of truth per fact.
scope: universal
source: [votepol, irt-flight-manager, collab]
---

# Documentation taxonomy

Every fact has exactly one home. Put each kind of information where an agent (and
a human) will look for it, and don't duplicate it elsewhere.

| Information                                              | Lives in                    |
| ------------------------------------------------------- | --------------------------- |
| How to write code here (conventions, patterns, rules)   | `.claude/rules/*.md`        |
| Why a decision was made; alternatives considered        | `docs/adr/*.md`             |
| Architecture, runbooks, deployment, onboarding          | `docs/*.md`                 |
| How the agent operates (git, PRs, planning, delegation) | `.claude/skills/`, `.claude/rules/` |
| Why *this line* does something non-obvious              | a code comment (see `commenting.md`) |
| Project overview + navigation to the above              | `CLAUDE.md`                 |

## Keep rule files small and single-topic

- One concern per rule file. A rule that covers three topics loads three topics'
  worth of context every time any one applies.
- Scope rules to the files they govern with `paths:` frontmatter globs so an
  agent loads a rule only when relevant files are in play. Small, scoped files
  prevent context bloat and improve adherence.
- Prefer bullets and short ✅/❌ examples over prose. A rule is instructions, not
  an essay.

## One canonical source of truth per fact

- State each fact **once** and link to it from elsewhere; never copy it. Two
  copies of a rule drift, and readers can't tell which is current.
- When the canonical source is code (a schema, a generated type, a contract),
  point docs at the code rather than re-describing the shape in prose.
- If sample code in docs is illustrative but not yet implemented, mark it
  clearly (e.g. a "design sketch — not implemented" warning) so nobody assumes it
  exists.

## Layer CLAUDE.md, don't centralise everything

Keep a concise root `CLAUDE.md` with the project overview, key commands, and a
navigation table pointing to the detailed docs and rules. In a monorepo, give
each package/app its own focused `CLAUDE.md` describing that unit. Keep each file
short and locally relevant rather than one giant file.

## Keep a running progress log without unbounded growth

For cross-session memory, maintain a progress log by condensing the previous
detailed entry to a sentence or two and appending a new dated, detailed entry
(what was accomplished, decisions made, next steps). The result is many short
historical summaries plus one rich current entry.
