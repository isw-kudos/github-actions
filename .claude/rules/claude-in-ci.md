---
description: Run Claude in GitHub CI safely — an @claude mention responder and an automatic code-review on every non-draft PR, both with least-privilege permissions and a tightly scoped tool allowlist.
scope: universal
paths:
  - ".github/workflows/claude.yml"
  - ".github/workflows/claude-code-review.yml"
tags: [ci, claude, code-review, security]
source: [collab, votepol, carbonhalo]
---

# Claude in CI

Two complementary workflows. Both authenticate with a `CLAUDE_CODE_OAUTH_TOKEN`
secret and use `anthropics/claude-code-action` (SHA-pinned, per the
github-actions rule).

## 1. `@claude` mention responder (`claude.yml`)

Runs when someone writes `@claude` in an issue, PR comment, or review. Gate the
job on the mention so it never runs unprompted.

```yaml
on:
  issue_comment: { types: [created] }
  pull_request_review_comment: { types: [created] }
  issues: { types: [opened, assigned] }
  pull_request_review: { types: [submitted] }

jobs:
  claude:
    if: |
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@claude')) ||
      (github.event_name == 'pull_request_review_comment' && contains(github.event.comment.body, '@claude')) ||
      (github.event_name == 'pull_request_review' && contains(github.event.review.body, '@claude')) ||
      (github.event_name == 'issues' && (contains(github.event.issue.body, '@claude') || contains(github.event.issue.title, '@claude')))
```

- Grant `actions: read` (via `additional_permissions`) so Claude can read CI
  results on the PR it's responding to.
- Keep write permissions to the minimum the responder needs. Default to read-only
  (`contents/pull-requests/issues: read`) and only widen to `write` if the
  workflow is meant to push commits or edit PRs/issues.
- **The mention check is not the security gate.** On a public repo anyone can
  write `@claude` in a comment; what actually gates execution is the action's
  built-in check that the triggering actor has write access to the repo. Never
  disable or work around that check, and remember `issue_comment`-triggered
  ("ChatOps") workflows are TOCTOU-prone by nature — that's why this workflow
  stays read-only with a narrow tool allowlist (see `workflow-security.md`).
- Comment/issue bodies are untrusted input. They're passed to Claude as a
  prompt, not interpolated into `run:` — keep it that way, and never echo
  `github.event.*` fields into shell commands in these workflows.

## 2. Automatic code review (`claude-code-review.yml`)

Runs `/code-review` on every non-draft PR. Trigger on the PR lifecycle events
that produce reviewable changes:

```yaml
on:
  pull_request:
    types: [opened, synchronize, ready_for_review, reopened]
```

Use the marketplace code-review plugin and pass the PR reference as the prompt:

```yaml
with:
  claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
  plugin_marketplaces: 'https://github.com/anthropics/claude-code.git'
  plugins: 'code-review@claude-code-plugins'
  prompt: '/code-review:code-review ${{ github.repository }}/pull/${{ github.event.pull_request.number }}'
```

Reviewing needs only read access (`contents/pull-requests: read`, `id-token: write`).

## Least-privilege tool scoping is mandatory

Constrain what Claude may execute with a `--allowed-tools` allowlist in
`claude_args`. Grant only the verification/read commands the task needs — never
an unbounded `Bash(*)`.

```yaml
claude_args: >-
  --allowed-tools "Bash(git *),Bash(gh *),Bash(npm run test*),Bash(npm run build*),Bash(npm run lint*),Bash(find *),Bash(grep *),Bash(ls *)"
```

Adjust the package-manager/script commands (`pnpm`/`npm`/`turbo`, `db:generate`,
etc.) to match the repo. Add commands one at a time as needs arise; keep the
list as narrow as possible.

## Optional: run reviews only on selected PRs

To save cost/noise you can gate the auto-review to specific branches or a label
(e.g. `renovate/*` branches or a `claude-review` label) and add
`paths-ignore` for docs, plus a `concurrency` group keyed to the PR number with
`cancel-in-progress`.
