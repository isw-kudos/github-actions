---
name: branch
description: Use when creating a git branch. Enforces the Conventional Branch naming scheme (type/description) with valid/invalid examples.
allowed-tools: Bash(git checkout -b *), Bash(git switch -c *), Bash(git switch --create *), Bash(git branch *)
---

# Branch

Create branches using **Conventional Branch** naming: `<type>/<description>`.
Never work directly on `main`/`master` — always branch first.

## Before creating a branch

- Start from an up-to-date base: `git checkout main && git fetch --prune && git pull`.
- If the current branch name looks unrelated to the task, **ask** whether to
  create a new branch or continue on the current one — don't pile unrelated work
  onto an existing feature branch.

## Format

```
<type>/<description>
```

- **`<type>`** is one of: `feature`, `fix`, `hotfix`, `release`, `chore`.
- **`<description>`** is a short, lower-case, hyphen-separated summary.
- Lowercase alphanumerics, hyphens, and dots only.
- No leading, trailing, or consecutive hyphens or dots.
- Optionally embed a ticket/task ID: `feature/PROJ-123-add-export`.

## Grammar (ABNF)

```abnf
branch      = type "/" description
type        = "feature" / "fix" / "hotfix" / "release" / "chore"
description = segment *("-" segment) *("." segment *("-" segment))
segment     = 1*(lowercase / DIGIT)
lowercase   = %x61-7A            ; a-z
```

## Examples

✅ Valid

```
feature/add-csv-export
fix/null-pointer-on-empty-list
hotfix/patch-login-redirect
release/2.4.0
chore/bump-dependencies
feature/PROJ-123-user-invites
```

❌ Invalid

```
Feature/AddExport          # uppercase
feature/add_export         # underscore
feature//add-export        # empty segment
-feature/add-export        # leading hyphen
feature/add--export        # consecutive hyphens
add-export                 # missing type/
wip                        # missing type/ and description
```

## Create it

```sh
git switch -c feature/add-csv-export     # or: git checkout -b feature/add-csv-export
```
