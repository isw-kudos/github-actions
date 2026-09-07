---
name: git
description: Use before ANY destructive or history-rewriting git operation (force-push, reset --hard, clean -fd, branch -D, rebase on a pushed branch, checkout that discards changes). A safety checklist — confirm with the user first.
user-invocable: false
---

# Git safety

A checklist to consult **before** running any destructive git operation. This
skill intentionally has **no tools** — it is guardrails, not an executor. The
agent still runs git through its normal Bash permission, but only after clearing
these checks.

## Golden rules

- **Never commit directly to `main`/`master`.** Branch first, then open a PR.
- **Confirm with the user before any destructive op below.** State exactly what
  will be lost and wait for an explicit go-ahead.
- **Never delete a remote branch** (`git push origin --delete`, `git push :branch`).
- **Never force-push a shared branch** (`main`, `develop`, anything others may
  have pulled). Force-push only your own unshared feature branch, and prefer
  `--force-with-lease` over `--force`.

## Destructive operations — stop and confirm

Each of these can silently destroy uncommitted or unpushed work. Confirm with
the user first, and for the ones noted, run the dry-run/backup step first.

- `git reset --hard <ref>` — discards all uncommitted changes **and** moves the
  branch. Irreversible for un-stashed work. Confirm; consider `git stash` or a
  backup branch first.
- `git clean -fd` — **deletes untracked files and directories.** Always dry-run
  first: `git clean -nd` (shows what would be deleted), review the list, then run.
- `git checkout -- <path>` / `git restore <path>` — discards uncommitted changes
  to those files. Confirm they are not wanted.
- `git checkout <branch>` / `git switch <branch>` when the tree is dirty — can
  overwrite or block on local changes. Check `git status` first.
- `git branch -D <branch>` — force-deletes a branch even if unmerged. Confirm the
  work is preserved elsewhere (merged PR, backup ref).
- `git rebase` **on a branch that has been pushed / shared** — rewrites history
  others may have. Confirm, and force-push with `--force-with-lease` only.
- `git push --force` / `--force-with-lease` — see golden rules; never on shared
  branches.
- `git filter-branch` / `git filter-repo` / history rewrites — treat as a major
  operation; confirm scope and take a backup ref first.

## Make loss recoverable

Before a risky operation, create a cheap safety net:

```sh
git branch backup/<name>        # a ref that keeps the current tip reachable
git stash push -u -m "<why>"    # only when the user has confirmed a reset path
```

If something does go wrong, `git reflog` still holds recent tips — check it
before assuming work is gone.

## When in doubt

Ask. A five-second confirmation is always cheaper than recovering (or failing to
recover) a wiped working tree.
