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

### Consumer migration (same day)
- `helm-deploy-v1.0.0` released (#35). Org vars `GCP_PROJECT`,
  `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT` created, scoped to
  boards and collab.
- boards: dev8 (#386, merged; live run = helm revision 136) and staging/prod
  (#390, merged). The dev environment was retired instead of migrated (#387):
  `:dev` images only ever came from the dead `dev` branch.
- collab: dev8, isw, demo (#860, open).
- GitHub Environments `dev8`/`staging`/`production` (boards) and
  `dev8`/`isw`/`demo` (collab) created with a `main`-only deployment branch
  policy; verified a feature-branch dispatch is rejected at job start. Caller
  docs live in each repo's `docs/DEPLOYMENT(S).md`, not here (#38).

### Next Steps
- Merge collab #860, dispatch dev8 → demo → ISW from `main`.
- Delete `deploy-gcloud.yaml` / `deploy-helm-in-isw.yaml` from devops once
  #860 is in; the only remaining devops refs are `retag-image` and the
  `build-*` pins.
- Later: SOPS or a split for the values files, OCI chart source.

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
