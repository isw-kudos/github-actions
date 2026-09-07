---
description: How to write GitHub Actions workflows at ISW — SHA-pin actions, least-privilege tokens, reusable workflows with path filters, skip on docs/drafts, cancel-in-progress, keyless cloud auth.
scope: universal
paths:
  - ".github/workflows/**"
  - ".github/actions/**"
tags: [ci, github-actions, security, supply-chain]
source: [collab, votepol, boards, carbonhalo, terradeploy, devops]
---

# GitHub Actions workflows

## Pin every action to a full commit SHA (never a tag/branch)

Tag and branch refs can be silently repointed at malicious code. Pin to the
40-char commit SHA and add a trailing `# vX.Y.Z` comment so Renovate can track
and bump it. This is enforced for third-party AND internal/org actions.

```yaml
# ✅ SHA-pinned with a version comment Renovate can read
- uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v4.2.2
- uses: actions/create-github-app-token@d72941d797f4b1b78fb6bf8ba0e6bb7c8b62a3f9 # v2.0.6

# ❌ tag ref — can be moved to attacker-controlled code
- uses: actions/checkout@v4
# ❌ branch ref — mutable
- uses: some-org/action@main
```

Configure Renovate with `pinDigests: true` for `github-actions` so new/edited
`uses:` lines get pinned automatically. For internal reusable workflows/actions
referenced with a version-comment convention, add a custom regex manager (see
the `renovate` rule) so those digests stay current too.

## Declare least-privilege `permissions` per workflow

Never rely on the default broad `GITHUB_TOKEN`. Every workflow declares a
top-level `permissions:` block granting only what it needs; individual jobs may
narrow further.

```yaml
# ✅ scoped to what the job actually does
permissions:
  contents: read      # checkout
  id-token: write     # OIDC to a cloud/registry
# add only when needed:
#   packages: write   # push images
#   pull-requests: write / issues: write   # comment on a PR/issue
#   actions: read     # read other workflow runs / CI results
```

Default to `contents: read`. Add each extra permission with a comment saying why.

## Centralise heavy logic in reusable workflows; call them per service

Put build/deploy/test logic in one `workflow_call` workflow and call it from
thin per-service/per-environment wrappers that differ only in inputs. Prod
differs from staging in data, not logic.

```yaml
# thin caller — build-<service>.yaml
jobs:
  build:
    uses: your-org/devops/.github/workflows/docker-build-generic.yml@<sha> # v1.2.3
    if: github.event_name == 'push' || github.event.pull_request.draft == false
    # Name the secrets the callee consumes — never `secrets: inherit`, which
    # hands the called workflow every secret in the repo.
    secrets:
      REGISTRY_TOKEN: ${{ secrets.REGISTRY_TOKEN }}
    with:
      dockerfile_path: apps/<service>/Dockerfile
      image: <service>
      tag: ${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || github.ref_name }}
```

`secrets: inherit` is the secrets equivalent of `permissions: write-all`: a
compromised or buggy callee can read everything. It is only acceptable when the
callee declares no `secrets:` inputs (GitHub then rejects a named list) — and
even then, leave a comment saying so.

At ISW the shared reusable workflows/actions live in the `isw-kudos` org (e.g.
`isw-kudos/github-actions`, `isw-kudos/devops`). Reference them by SHA.

## Trigger per-service builds with path filters

Only run a service's pipeline when its own files change. Use per-service
`paths:` on the trigger, or `dorny/paths-filter` for one-workflow fan-out.
Always include the workflow's own file and any shared paths (workspace
packages, the lockfile, submodules).

```yaml
on:
  pull_request:
    paths:
      - "apps/<service>/**"
      - "packages/**"
      - "pnpm-lock.yaml"
      - ".github/workflows/build-<service>.yaml"
```

## Skip CI on docs/infra-only changes and never run on drafts

Use `paths-ignore` to skip runs that can't affect the build, with a re-include
so the workflow re-runs when its own file changes. Gate jobs on non-draft PRs.

**Exception:** never draft-gate a workflow whose check is listed in a
`wait-for-required-checks` aggregation gate (`required-checks.yml`). The gate
treats `skipped` as a pass and is not re-triggered by `ready_for_review`, so a
draft-gated required check lets the PR merge without that check ever running.
See `.github/actions/wait-for-required-checks/README.md`.

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
    paths-ignore:
      - "**/*.md"
      - "docs/**"
      - ".github/**"
      - "!.github/workflows/ci.yml"   # re-run when this workflow changes

jobs:
  test:
    if: github.event_name != 'pull_request' || github.event.pull_request.draft == false
```

## Cancel superseded runs with a concurrency group

Cancel redundant in-progress runs on the same ref so pushes/PR updates don't
pile up. It's fine to cancel-in-progress everywhere; if you want pushes to
`main`/release to always finish, restrict cancellation to PR events.

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
# or PR-only:
#   cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

## Authenticate to clouds/registries with OIDC — no long-lived keys

Exchange the workflow's OIDC token for short-lived cloud credentials. Never
store cloud access keys or service-account JSON as GitHub secrets — only store
non-secret identifiers (account IDs, provider/role names).

```yaml
permissions:
  id-token: write            # required to mint the OIDC token
steps:
  # AWS
  - uses: aws-actions/configure-aws-credentials@<sha> # v4
    with:
      role-to-assume: arn:aws:iam::<account>:role/<ci-role>
      aws-region: <region>
  # GCP (Workload Identity Federation)
  - uses: google-github-actions/auth@<sha> # v3
    with:
      workload_identity_provider: projects/.../providers/github-provider
      service_account: ci@<project>.iam.gserviceaccount.com
```

## Mint a scoped GitHub App token for cross-repo / private submodule access

Don't embed a long-lived PAT. Generate a short-lived, repo-scoped GitHub App
installation token per run and use it for private submodule/cross-repo checkout.

```yaml
- uses: actions/create-github-app-token@<sha> # v2
  id: app_token
  with:
    app-id: ${{ vars.CI_APP_ID }}
    private-key: ${{ secrets.CI_APP_PRIVATE_KEY }}
    owner: your-org
    repositories: this-repo,shared-services

- uses: actions/checkout@<sha> # v4
  with:
    submodules: recursive
    token: ${{ steps.app_token.outputs.token }}
    persist-credentials: false   # don't leave the token in .git/config
```

For Docker builds that need private submodules, pass the token as a BuildKit
build secret (`GIT_AUTH_TOKEN`) rather than baking it into the image.

## Checkout hygiene: `persist-credentials: false`

`actions/checkout` writes its token into `.git/config` by default, where every
later step (and anything they download or execute) can read it. Set
`persist-credentials: false` unless the job genuinely pushes back to the repo.

## Security hardening is its own rule

Trigger choice (`pull_request` vs `pull_request_target`), script/output
injection from untrusted event data, protecting the workflow definition with
CODEOWNERS + rulesets, automated scanning with zizmor, and self-hosted runner
rules live in `workflow-security.md`. Org/repo-level Actions policy (the
allowed-actions allowlist, default token permissions, fork-PR approval) lives
in `actions-policy.md`. Apply those alongside this rule for any workflow change.
