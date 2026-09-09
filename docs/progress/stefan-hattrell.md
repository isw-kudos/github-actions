# Progress — stefan-hattrell

## 2026-09-09 (retag-images-ghcr)
### Accomplished
- New `retag-images-ghcr` component (`.github/workflows/retag-images-ghcr.yml`):
  `crane tag` across a newline list of `ghcr.io/<owner>/<image>` names, source
  → target. Every source digest (and the target's current digest) is resolved
  in parallel before any write, so a missing image fails with nothing moved;
  retags run in parallel, every failure is reported, and the job summary
  tables image / source digest / previous target digest / result. Replaces
  the devops `retag-image` docker pull-tag-push action used by collab and
  boards, which pulled every layer and flattened the OCI index (digest
  changed on promote).
- Inputs allowlisted (OCI tag and repository regexes, one name per line,
  source ≠ target); everything reaches `run:` via env. `permissions: {}` +
  job `packages: write`, concurrency per target tag with no cancel, 10 min
  timeout. Zizmor clean.
- Both `run:` blocks exercised against a stub `crane` (happy / missing source
  / invalid inputs / empty list / one push denied).
- Full component wiring (releaserc, release workflow, renovate scope rule,
  commit-msg hook case, docs/CLAUDE.md/README) and plan at
  `docs/plans/2026-09-09-retag-images-ghcr.md`.
- Consumer wrappers drafted in collab (`retag-images.yml`) and boards
  (`retag-images.yaml`) worktrees with a placeholder pin; their callers need
  no change.

### Decisions
- Named `retag-images-ghcr`, not `retag-images`, and no registry/namespace
  inputs: auth is the caller's `GITHUB_TOKEN`, which only reaches ghcr.io
  under the caller's owner. Same convention as `docker-build-ghcr`.
- Image list is an input; the workflow knows nothing about Huddo. Consumers
  keep a thin wrapper so the list lives once per repo.
- Always tag even when already at the source digest (one path; summary says
  `unchanged`). Cross-registry copy (quay) deliberately out of scope.

### Next Steps
- Merge → `retag-images-ghcr-v1.0.0`; fill the pin in the collab and boards
  wrapper PRs and merge them; then delete `retag-image` from devops.

## 2026-09-09 (helm-deploy)
Added the `helm-deploy` component (one `helm upgrade --install` for GKE via
Workload Identity and kubeconfig targets, replacing devops `deploy-gcloud.yaml`
/ `deploy-helm-in-isw.yaml`) with full component wiring and a plan carrying
the eight-caller migration table; `wait` + rollback on by default.

## 2026-09-08
Migrated devops `docker-build-generic.yml` here as the `docker-build-ghcr`
component (PR #24, `docker-build-ghcr-v1.0.0`), then pinned the
`conventionalcommits` preset below 10 across all release workflows after the
first release failed in `generateNotes`. Consumer re-pointing still pending.

## 2026-09-08 (earlier)
Replaced the unmaintained turbo-repo-cache upstream with an in-house node24
server sub-action (PR #19, released as `turbo-repo-cache-v2.0.0`), then fixed
all seven components to the `conventionalcommits` preset so `type(scope)!:`
releases a major (PR #20).

## 2026-09-07
Audited `required-checks.yml` for draft-PR bypass (safe; invariant documented,
PR #16) and hand-rolled the pre-commit wrapper steps with SHA-pinned
`actions/cache` (PR #17, merged). Admin follow-up still open: drop
`pre-commit/action@*` from the repo allowed-actions patterns.
