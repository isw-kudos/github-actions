---
description: Commit .claude/rules and .claude/skills (shared, reviewable); gitignore local state (settings.local.json, projects/, todos/, *.jsonl). Layer CLAUDE.md (root + per-package). Keep rules small and glob-scoped.
scope: meta
source: [irt-flight-manager, collab, boards, votepol]
tags: [claude, config, hygiene, docs]
---

# `.claude/` config hygiene

Treat agent configuration like code: share and review the parts that are team
guidance, and gitignore per-developer machine state.

## Commit vs gitignore

**Commit** (team-shared, versioned, reviewable):

- `.claude/rules/**` — the rule files.
- `.claude/skills/**` — skills and their scripts.
- `.claude/commands/**` and `.claude/hooks/**`.
- `CLAUDE.md` files.
- A shared, secret-free `.claude/settings.json` (permission allowlist, hook
  registrations).

**Gitignore** (local, per-developer, may contain machine paths or secrets):

```gitignore
# Claude Code local state (rules/skills committed; local config excluded)
.claude/settings.local.json
.claude/projects/
.claude/todos/
.claude/*.jsonl
.claude/cache/
```

Never commit `settings.local.json` — it holds per-developer permissions and
often local filesystem paths. Secrets never go in any committed settings file.

## Layered CLAUDE.md

- A **concise root `CLAUDE.md`**: platform overview, key commands, stack, and a
  navigation table that routes to the right place.
- A **focused `CLAUDE.md` per package/app** describing that unit's architecture,
  request flow, "adding a resource" recipe, and local rules.
- Keep each file short and locally relevant; the root routes, the leaves detail.

## Keep rules small and glob-scoped

- One topic per rule file. Small files load and adhere better than one giant file.
- Scope each rule to the files it applies to with frontmatter `paths:` globs, so
  the agent loads a rule only when touching relevant files:

  ```yaml
  ---
  paths:
    - "apps/web/**/*.tsx"
    - "apps/web/**/*.css"
  ---
  ```

  Omit `paths:` for genuinely always-on rules. This prevents context bloat and
  keeps adherence high.

## Multi-root / submodule repos

If a submodule may be opened standalone, duplicate the cross-cutting skills into
its `.claude/` too, so agent guidance is present regardless of which repo root
the agent launches from.
