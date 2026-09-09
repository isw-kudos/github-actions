# Progress — stefan-hattrell

## 2026-09-09
### Accomplished
- New `helm-deploy` component (`.github/workflows/helm-deploy.yml`): one
  generic `helm upgrade --install` replacing devops `deploy-gcloud.yaml` and
  `deploy-helm-in-isw.yaml`. `target` selects auth (`gke` via Workload
  Identity, `kubeconfig` via a `KUBECONFIG` secret), `runner` selects where it
  runs, `config_repository` names the repo holding chart + values (devops for
  now; empty = the caller). GKE identity (project, cluster, location, WIF
  provider, service account) is passed as inputs, nothing org-specific baked
  into this public repo.
- Security baseline: SHA-pinned actions, `permissions: {}` + job grant,
  `persist-credentials: false`, app token scoped to the one config repo with
  `permission-contents: read`, allowlisted `owner/name` before it reaches
  `$GITHUB_OUTPUT`, every `run:` via env vars, per-target input/secret
  validation with one error per missing item. Zizmor and pre-commit clean.
- Full component wiring (releaserc, release workflow, renovate scope rule,
  commit-msg hook case, docs/CLAUDE.md/README) and plan at
  `docs/plans/2026-09-09-helm-deploy-migration.md` with the eight-caller
  migration table.
- Deploy and validate steps unit-tested locally against a stub `helm`
  (empty/space/newline `helm_args`, glob safety, `wait` on/off, missing
  inputs, malformed config repo).

### Decisions
- Single reusable workflow with a `target` switch, not a composite action:
  callers are already one `uses:` job and `environment:` inside the workflow
  already ties the gate and the apply together.
- `wait` on by default (`--wait --rollback-on-failure --timeout 10m`): a
  broken image now fails the run and rolls back instead of leaving a
  half-rolled release. Behaviour change for all eight callers, accepted.
- Helm pinned to `v4.2.4` (Renovate-tracked). `setup-helm` defaults to
  `latest`, so callers already run Helm 4; `--atomic` is deprecated there.
- `environment` is a required input: empty-string `environment:` semantics
  are unverified and Environments are the "what's deployed" surface.
- `helm_args` is whitespace-split, not a newline list, so the four
  `resolve-tags` jobs need no change. Values with spaces are unsupported.
- Kept the Huddo `BUILD_NUMBER` / `podAnnotations.buildNumber` `--set` lines
  for parity; harmless for charts that ignore `global`.

### Next Steps
- Merge PR → `helm-deploy-v1.0.0`. Set org vars `GCP_PROJECT`,
  `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT` from devops
  `deploy-gcloud.yaml`.
- Consumer PRs per the plan's migration table: boards `deploy-dev.yaml`
  first (gke), then collab `deploy-dev8.yml` (kubeconfig), then the other six.
  boards `deploy-dev8-quay.yaml` must drop its trailing-backslash `helmArgs`
  hack; boards dev/staging/prod must pass `chart` and `namespace` explicitly.
  Drop the devops deploy-* freeze rules from both `renovate.json` files.
- Delete `deploy-gcloud.yaml` / `deploy-helm-in-isw.yaml` from devops once
  all eight callers are moved. Later: SOPS or a split for the values files,
  OCI chart source.

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
