---
description: Org/repo GitHub Actions policy — restrict which actions may run to an explicit allowlist, default the GITHUB_TOKEN to read-only, and require approval for fork PR runs. These are settings, not files; verify them with gh api.
scope: universal
paths:
  - ".github/**"
tags: [ci, github-actions, security, supply-chain, governance]
source: [boards, irt-flight-manager]
---

# Actions policy: restrict which actions may run

SHA-pinning (`github-actions.md`) controls *which commit* of an action runs.
The allowed-actions policy controls *which actions can run at all* — it is the
outermost layer of the supply-chain defence, and it lives in GitHub settings,
not in the repo. When setting up CI for a repo, verify these settings rather
than assuming them.

## Allow only GitHub-owned + an explicit allowlist

Set the policy at the **organization** level so every repo inherits it (repos
can only narrow it further, never widen it): *Settings → Actions → General →
Allow `<org>`, and select non-`<org>`, actions and reusable workflows*.

Via the API:

```bash
# Current policy
gh api orgs/<org>/actions/permissions
gh api orgs/<org>/actions/permissions/selected-actions

# Restrict to selected actions
gh api -X PUT orgs/<org>/actions/permissions \
  -f enabled_repositories=all -f allowed_actions=selected

# GitHub-owned + an explicit third-party allowlist
gh api -X PUT orgs/<org>/actions/permissions/selected-actions \
  -F github_owned_allowed=true \
  -F verified_allowed=false \
  -f 'patterns_allowed[]=anthropics/claude-code-action@*' \
  -f 'patterns_allowed[]=zizmorcore/zizmor-action@*' \
  -f 'patterns_allowed[]=aws-actions/configure-aws-credentials@*'
```

- `github_owned_allowed: true` covers `actions/*` (checkout, cache, etc.) and
  actions in the org itself.
- Keep `verified_allowed: false` — "verified creator" is a Marketplace badge,
  not a security review. Allowlist each third-party action deliberately.
- **Treat every `patterns_allowed` addition as a supply-chain decision** with
  the same review bar as adding a dependency: read what the action does, check
  its maintenance, prefer a GitHub-owned or first-party alternative. Vendoring
  a small action into `.github/actions/` (a local `./` action needs no
  allowlist entry) often beats allowlisting a third party.
- The allowlist and SHA-pinning are complementary, not alternatives: the
  allowlist stops unvetted actions from being introduced at all; pinning +
  Renovate keeps the vetted ones immutable and current. Keep both.

## Default the `GITHUB_TOKEN` to read-only

*Settings → Actions → General → Workflow permissions → Read repository
contents and packages permissions*, at the org level. A workflow that forgets
its `permissions:` block then fails safe instead of getting a write-all token —
this turns the least-privilege rule in `github-actions.md` from advisory into
enforced.

```bash
gh api orgs/<org>/actions/permissions/workflow \
  --jq '{default_workflow_permissions, can_approve_pull_request_reviews}'
# want: "read" / false
```

Keep *Allow GitHub Actions to create and approve pull requests* off unless a
specific automation needs it — a workflow that can approve PRs can satisfy a
required-review rule.

## Require approval for fork PR runs

*Settings → Actions → General → Fork pull request workflows* — require
approval for **all outside collaborators**, so a first-time (or any external)
contributor's workflow run doesn't execute until a maintainer has looked at
the diff. This is the correct mitigation for "a fork PR could edit ci.yml" —
not `pull_request_target` (see `workflow-security.md`).

## Verify, don't assume

These settings are invisible in the repo tree and can drift. When importing
this module into a repo, run the three `gh api` reads above and record any
gaps as follow-up work for an org admin — enterprise- or org-owned settings
usually can't be fixed from a repo PR.
