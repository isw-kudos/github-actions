---
name: commit
description: Use when creating a git commit. FIRST blocks committing build artefacts, local config, or secrets (gitignore them); then enforces Conventional Commits 1.0.0.
allowed-tools: Bash(git commit *)
---

# Commit

## Step 1 — never commit these (do this BEFORE anything else)

Check `git status`. If any of the following appear as staged or new files,
**do not commit them** — add them to `.gitignore` first, then continue:

- **Build artefacts:** `dist/`, `build/`, `.next/`, `*.tsbuildinfo`, `.turbo/`,
  `cdk.out/`, `coverage/`, compiled output.
- **Local / machine config:** `.env`, `.env.*`, `*.local.json`, `.mcp.json`,
  `.claude/settings.local.json`, editor/IDE state.
- **Secrets & credentials:** keys, tokens, `*.pem`, service-account JSON,
  anything that looks like a credential. If a secret was already committed,
  stop and tell the user — it must be rotated, not just removed.
- **Dependencies:** `node_modules/`, vendored packages.

If you had to add anything to `.gitignore`, commit that change too (it belongs in
the same or a preceding commit).

## Step 2 — Conventional Commits 1.0.0

Format:

```
<type>[optional scope][optional !]: <description>

[optional body]

[optional footer(s)]
```

### Types

- `feat:` — a new feature (correlates with SemVer MINOR).
- `fix:` — a bug fix (correlates with SemVer PATCH).
- `docs:`, `style:`, `refactor:`, `perf:`, `test:`, `build:`, `ci:`, `chore:`,
  `revert:` — non-feature/non-fix changes.

### Rules

- Description is imperative, lower-case, no trailing period: `add`, not `added`/`adds`.
- **Scope** it to the affected package/area to keep release tooling clean:
  `feat(api):`, `fix(web):`, `chore(deps):`.
- **Breaking changes:** append `!` after the type/scope **and/or** add a
  `BREAKING CHANGE:` footer describing the break (correlates with SemVer MAJOR).
- Keep the subject line ≤ ~72 chars; put detail in the body (wrap at ~72).
- One logical change per commit.

### Examples

```
feat(auth): add password-reset flow

fix(api): reject requests with an expired token

refactor(shared): extract date-formatting into a helper

feat(api)!: return 404 instead of 200 for missing records

BREAKING CHANGE: clients relying on the empty-body 200 must handle 404.
```

## Committing

- Do not commit on `main`/`master` — if you are on it, stop and branch first
  (see the `branch` skill).
- Do not add `--no-verify` to bypass hooks unless the user explicitly asks.
