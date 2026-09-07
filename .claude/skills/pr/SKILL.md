---
name: pr
description: Use when opening a pull request. Syncs with main, opens the PR as a draft, runs a local review in a separate context, and only marks it ready once it passes. Flips back to draft while addressing requested changes.
allowed-tools: Bash(gh pr create *), Bash(gh pr ready *)
---

# Pull request

Open every PR **as a draft**, review it locally before asking anyone (or CI) to
look, and use the draft ↔ ready toggle as the signal for "please review". Draft PRs
don't trigger the review/CI workflows (they gate on `ready_for_review` /
`draft == false`), so this keeps GitHub Actions from running on unfinished or
mid-iteration work.

## Step 1 — sync with main first

Bring the branch up to date so review and CI run against current `main`:

```sh
git fetch origin
git merge origin/main        # resolve any conflicts, keep the tree green
git push -u origin HEAD       # publish the branch and set upstream
```

If the merge introduces conflicts, resolve them and re-run your checks
(lint / typecheck / tests) before continuing.

## Step 2 — create the PR as a draft

Always open with `--draft`. Use a Conventional-Commits-style title
(`feat(api): add password reset`) so title checks and release tooling stay happy.
Fill in **every** section; write "N/A" where a section genuinely doesn't apply
rather than deleting it.

```sh
gh pr create --draft --title "<type>(<scope>): <description>" --body "$(cat <<'EOF'
## What
<one or two sentences: what this PR does>

## Why
<the problem or motivation; link the issue/task>

## Changes
- <key change 1>
- <key change 2>

## Testing
<how it was verified: commands run, tests added, manual steps>

## Risks
<what could break; blast radius; anything reviewers should scrutinise>

## Deployment
<migrations, env vars, feature flags, ordering, or "no special steps">
EOF
)"
```

## Step 3 — review the draft locally, in a separate context

Before marking it ready, review the draft **in a fresh context** (a separate
`/review` / `/code-review` pass, ideally a subagent that didn't write the code) so
the review is unbiased. Feed it the branch diff (`git diff main...HEAD`).

Address every finding, commit and push the fixes (see the `commit` skill), and
re-run your local checks. Only continue when the review is clean.

## Step 4 — mark it ready

Once the local review passes, hand it to reviewers and CI:

```sh
gh pr ready        # draft → ready_for_review (this is what triggers CI/review)
```

## Step 5 — when a review asks for changes, go back to draft

While you iterate on requested changes, flip the PR **back to draft** so CI and
reviewers aren't spent on each intermediate push:

```sh
gh pr ready --undo   # ready → draft, while you work
```

Make the changes, then repeat **Step 3** (local review in a separate context) and
**Step 4** (`gh pr ready`). Never mark ready again without re-reviewing first.

> `gh pr ready --undo` needs draft-PR support on your GitHub plan (some private-repo
> plans lack it). If it's unavailable, leave the PR ready and signal
> review-in-progress another way (a label, or a "🚧 iterating" comment).

## Notes

- Keep PRs small and single-purpose — a bug fix or one feature reviews best.
  Split unrelated changes, bulk renames, and framework upgrades into their own PRs.
- The draft state is the "not ready to look yet" signal — use it for genuine
  work-in-progress too, not only during the initial review.
- Never target `main` from `main` — you must be on a feature branch (see the
  `branch` skill).
