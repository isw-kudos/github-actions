# helm-deploy: one generic Helm deploy workflow for GKE, on-prem, and future targets

## Context

`boards` (5 `deploy-*.yaml`) and `collab` (3 `deploy-*.yml`) deploy Helm charts by
calling one of two reusable workflows in the **private** `isw-kudos/devops` repo,
frozen at `2d92d6c5`:

| devops workflow | runner | auth | callers |
|---|---|---|---|
| `deploy-gcloud.yaml` | org label `gcloud` | GCP Workload Identity Federation + `get-gke-credentials` | boards dev / staging / prod, collab demo |
| `deploy-helm-in-isw.yaml` | org label `isw` (on-prem) | kubeconfig secret via `azure/k8s-set-context` | boards dev8-ghcr / dev8-quay, collab dev8 / isw |

Apart from runner and auth the two are identical: mint a GitHub App token, check
out `devops` (charts in `helm-charts/*.tgz`, values in `boards/*.yaml` and
`collab/*.yaml`), `setup-helm`, `helm upgrade --install` with two Huddo-chart
`--set` lines that force a pod roll. devops publishes no tags, so both consumer
`renovate.json` files carry "freeze" rules and a comment saying the long-term exit
is to move these into `isw-kudos/github-actions`, which does publish tags.

Goal: one `helm-deploy` component here that covers both targets today and leaves
room for `aks` / `eks` later, brought up to this repo's security baseline. Values
files **stay in devops** for now (they contain secrets); the workflow takes the
config repo as an input so moving them later needs no workflow change.

Out of scope (follow-up PRs, listed at the end): editing boards/collab, deleting
the devops copies, moving/encrypting the values files, OCI chart sources.

## Architecture

```
caller job (boards/collab deploy-*.yml)
  uses: isw-kudos/github-actions/.github/workflows/helm-deploy.yml@<sha> # helm-deploy-vX.Y.Z
  with:    runner, target, environment, config_repository, chart, values, namespace,
           release_name, [helm_args], [gcp_* | (none)], [wait, timeout]
  secrets: HUDDO_DEVOPS_GITHUB_APP_PRIVATE_KEY (config repo ≠ caller), KUBECONFIG (target=kubeconfig)
    │
    ▼
  deploy  (runs-on: inputs.runner, environment: inputs.environment,
           permissions: contents: read + id-token: write)
    1. validate inputs   target ∈ {gke, kubeconfig}; per-target required inputs/secrets
                         present; config_repository matches ^owner/name$
    2. app token         only if config_repository set and ≠ github.repository
                         (client-id vars.HUDDO_DEVOPS_GITHUB_APP_ID, permission-contents: read,
                          owner/repositories from the validated input)
    3. checkout config   repo = config_repository or caller; ref = config_ref, or github.sha
                         when it is the caller; persist-credentials: false; workspace root
    4a. [gke]            google-github-actions/auth (WIF) → get-gke-credentials
    4b. [kubeconfig]     azure/k8s-set-context (method: kubeconfig, secrets.KUBECONFIG)
    5. setup-helm        version pinned (renovate-tracked, helm/helm github-releases)
    6. helm upgrade --install --namespace $NS --values $VALUES
                         --wait --rollback-on-failure --timeout $TIMEOUT      (when wait=true)
                         --set global.env.BUILD_NUMBER=$RUN_ID
                         --set-string global.podAnnotations.buildNumber=$RUN_ID
                         "${HELM_ARGS[@]}" $RELEASE $CHART        (all via env, no ${{ }} in run:)
```

Concurrency: `${{ github.workflow }}-${{ inputs.namespace }}-${{ inputs.release_name }}`,
`cancel-in-progress: false` (never kill a half-applied release).

## Key interfaces

`on.workflow_call` inputs (snake_case, matching `docker-build-ghcr.yml`):

| Input | Req | Default | Notes |
|---|---|---|---|
| `runner` | yes | | `runs-on` label(s): `gcloud`, `isw`, `ubuntu-latest`… Independent of `target`. |
| `target` | yes | | `gke` \| `kubeconfig`. Allowlist-validated in step 1. |
| `environment` | yes | | GitHub Environment name (deployments view; gha-security §6). Required rather than optional because an empty `environment:` is not reliably "no environment". |
| `config_repository` | no | `''` | `owner/name` holding chart + values (`isw-kudos/devops`). Empty = the calling repo. |
| `config_ref` | no | `''` | Ref of the config repo. Empty = default branch (or `github.sha` when config repo is the caller). |
| `chart` | yes | | Chart ref relative to the config checkout (`./helm-charts/huddo-boards-2.2.0.tgz`) or any ref helm accepts. No default (devops had a boards-specific one). |
| `values` | yes | | Values file relative to the config checkout. |
| `namespace` | yes | | No default (devops defaulted to `boards`). |
| `release_name` | yes | | Helm release name (was `chartName`). |
| `helm_args` | no | `''` | Extra args, whitespace-separated (`--set a=b --set c=d`). Values containing spaces are unsupported; use a values file. |
| `wait` | no | `true` | Adds `--wait --rollback-on-failure --timeout <timeout>`; a rollout that never becomes Ready fails the run and is rolled back. |
| `timeout` | no | `10m` | Helm timeout when `wait` is true. |
| `gcp_project`, `gke_cluster`, `gke_location`, `gcp_workload_identity_provider`, `gcp_service_account` | gke only | `''` | Callers pass `${{ vars.… }}`; nothing org-specific is baked into this public workflow. |

Secrets (`required: false`, presence validated at runtime via
`env: HAS_X: ${{ secrets.X != '' }}` because `secrets` is unavailable in step `if:`):

- `HUDDO_DEVOPS_GITHUB_APP_PRIVATE_KEY` — needed when `config_repository` is another repo (same name/var pairing as `docker-build-ghcr.yml`).
- `KUBECONFIG` — needed when `target: kubeconfig`.

Component wiring: tag prefix `helm-deploy-v`, scope `helm-deploy`, watched path
`.github/workflows/helm-deploy.yml`.

Reused patterns (copy, do not reinvent):
- App-token scoping + `.gitmodules`-style "secret presence via on-disk/env signal": `.github/workflows/docker-build-ghcr.yml`
- `environment: ${{ inputs.environment }}` + job-level `id-token: write`: `.github/workflows/ecs-deploy.yml`
- Renovate-tracked tool pin comment: `.github/workflows/tofu-pre-commit.yml` (`# renovate: datasource=github-releases depName=…` above the `version:` line)
- Release wiring recipe: `docs/plans/2026-09-08-docker-build-ghcr-migration.md`, `.claude/skills/per-component-versioning/SKILL.md`

## Implementation Order

- [x] 1. Commit this plan to `docs/plans/2026-09-09-helm-deploy-migration.md` (repo `planning` rule).
- [x] 2. Write `.github/workflows/helm-deploy.yml` per the architecture above. Resolve SHAs with `gh api repos/<o>/<r>/git/refs/tags/<tag>` for `google-github-actions/auth@v3`, `google-github-actions/get-gke-credentials@v3`, `azure/setup-helm@v5.0.0`, `azure/k8s-set-context@v5`; reuse the already-pinned `actions/checkout` and `actions/create-github-app-token` SHAs from `docker-build-ghcr.yml`. Pin helm `v4.2.4` (callers get `latest` = Helm 4 today, so this is parity; Helm 4 renamed `--atomic` to `--rollback-on-failure`, bare `--wait` is valid). Validation step fails with one clear message per missing item. `helm_args` read with `read -r -a` from an env var under `set -f`.
      _as built: the config-repo checkout ref expression is
      `inputs.config_ref || (foreign != 'true' && github.sha) || ''`; `helm_args`
      is read with `read -r -d '' -a` so it splits on spaces and newlines alike;
      the action pins landed on `google-github-actions/*@v3.0.0`,
      `azure/k8s-set-context@v5.0.1`, `azure/setup-helm@v5.0.1`._
- [x] 3. `releases/helm-deploy/.releaserc.js` (copy `releases/docker-build-ghcr/.releaserc.js`, change `scope`).
- [x] 4. `.github/workflows/release-helm-deploy.yml` (copy `release-docker-build-ghcr.yml`; change `paths:`, tag glob, `working-directory`).
- [x] 5. `renovate.json`: packageRule for `.github/workflows/helm-deploy.yml` (`chore` / scope `helm-deploy` / empty suffix). The existing `# renovate:` regex manager already covers the helm version pin.
- [x] 6. `.github/scripts/check-component-scope.sh`: add the `helm-deploy.yml` case.
- [x] 7. Docs: `docs/per-component-versioning.md` (Components + Renovate tables), `CLAUDE.md` (components + reusable-workflows tables), `README.md` usage section with a gke and a kubeconfig example.
- [x] 8. `zizmor --persona regular --offline` clean on both new workflows; `pre-commit run --all-files`; independent review of the workflow (adversarial pass, as for docker-build-ghcr).
      _review found the concurrency group keyed on `github.workflow` (the caller's
      name), so two caller workflows deploying one release could still race; now
      `helm-deploy-<environment>-<namespace>-<release_name>`. Also tightened the
      owner regex, made the same-repo comparison case-insensitive, and verified
      the live GCP binding is `attribute.repository_owner/isw-kudos`, so the
      `environment:`-driven OIDC `sub` change needs no IAM work._
- [x] 9. Progress log entry in `docs/progress/stefan-hattrell.md`.
- [ ] 10. PR titled `feat(helm-deploy): add generic helm deploy workflow (gke + kubeconfig targets)` → squash merge cuts `helm-deploy-v1.0.0`.

## Verification

```bash
zizmor --persona regular --offline .github/workflows/helm-deploy.yml .github/workflows/release-helm-deploy.yml
pre-commit run --all-files
node -e "require('./releases/helm-deploy/.releaserc.js')"
```

Shell of the deploy step, tested locally with a stub `helm` on `PATH` that prints its
argv: confirm arg order, that `helm_args` splits on spaces and newlines, that an
empty `helm_args` adds no empty argument, and that `wait: false` drops the three
wait flags.

Post-merge, first real runs (consumer PRs, one per repo):
1. boards `deploy-dev.yaml` → `helm-deploy` with `target: gke`, `runner: gcloud`, `environment: dev` (lowest-risk GKE env).
2. collab `deploy-dev8.yml` → `target: kubeconfig`, `runner: isw`, `environment: dev8`.
Check the Environments tab shows the deployment, `helm list -n <ns>` shows the new
revision, and pods rolled (the `buildNumber` annotation changed).

## Consumer migration (follow-up PRs, after `helm-deploy-v1.0.0` exists)

| Caller | Changes |
|---|---|
| boards deploy-dev / staging / prod | `uses:` → helm-deploy; add `runner: gcloud`, `target: gke`, `environment`, `config_repository: isw-kudos/devops`, `chart: ./helm-charts/huddo-boards-2.2.0.tgz` (was the devops default), `namespace: boards` (was the default), `gcp_*: ${{ vars.… }}`; `chartName` → `release_name`; `helmArgs` → `helm_args`; secret `devopsAppKey` → `HUDDO_DEVOPS_GITHUB_APP_PRIVATE_KEY` |
| boards deploy-dev8-ghcr / deploy-dev8-quay, collab deploy-dev8 / deploy-isw | `runner: isw`, `target: kubeconfig`, `environment`, `config_repository`; `kubeconfig` secret → `KUBECONFIG`; `chartName` → `release_name`; `helmArgs` → `helm_args` |
| boards deploy-dev8-quay | drop the trailing-backslash hack: `helm_args: ${{ inputs.imageTag != '' && format('--set global.imageTag={0}', inputs.imageTag) \|\| '' }}` |
| collab deploy-demo | as boards gke rows; `release_name: huddo`, `namespace: demo` |
| boards + collab renovate.json | remove the deploy-* files from the devops freeze rules (boards) / narrow the repo-wide freeze comment (collab); the new pins are maintained by the existing `isw-kudos/github-actions` regex manager |
| org vars (once) | `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`, `GCP_PROJECT` (values from devops `deploy-gcloud.yaml`) |

No IAM change: the WIF `repository` / `repository_owner` claims come from the
**caller**, not from where the reusable workflow lives. Runner groups `isw` and
`gcloud` are org-level with `allows_public_repositories: false`; the workload is the
private caller's, so the "no public workloads on self-hosted runners" rule holds.

## Notes / Deferred

- **One reusable workflow with a `target` switch, not a composite action or one
  workflow per target.** Callers are already a single `uses:` job, and
  `environment:` inside the reusable workflow already puts the gate and the apply
  in one job (the benefit the devops `deploy-helm` composite draft wanted). Split
  only if a third target needs materially different steps.
- **GKE auth details are inputs, not `vars` read inside.** This repo is public and
  the workflow is meant to be generic; inputs are an explicit, validated contract.
  Only `vars.HUDDO_DEVOPS_GITHUB_APP_ID` stays a `vars` lookup (an input default
  cannot reference `vars`; same as `docker-build-ghcr.yml`).
- **`wait` on by default (user decision).** Today's callers never wait, so a
  broken image now fails the run and is rolled back instead of leaving a
  half-rolled release. Default `10m`; callers can lower/raise per environment.
- **Helm pinned to 4.x with `--rollback-on-failure`.** `setup-helm` defaults to
  `latest`, so callers already run Helm 4; pinning removes silent drift and
  Renovate tracks the bump. `--atomic` is deprecated in Helm 4.
- **`environment` is required.** Empty-string `environment:` semantics are
  unverified and Environments are the "what's deployed" surface the release
  pipeline design leans on. GitHub auto-creates the environment on first use.
- **Huddo `--set … BUILD_NUMBER` / `podAnnotations.buildNumber` lines kept.**
  Behaviour parity for the eight callers; harmless for charts that ignore
  `global`. Revisit (move to `helm_args` or gate behind an input) only if a
  non-Huddo consumer objects.
- **`helm_args` whitespace-split, not newline-list.** Zero caller churn (the four
  `resolve-tags` jobs emit space-joined `--set` pairs). Safe from injection once
  `${{ }}` is out of `run:`; the only limitation is values with spaces.
- **`config_repository` defaults to the caller.** Keeps the future "values move
  out of devops" path a caller-side change only.
- **Chart and namespace have no defaults.** The devops defaults were
  boards-specific; three boards callers must now pass them explicitly.
- **`--rollback-on-failure` on a first-time install uninstalls the failed
  release** (atomic semantics), and Helm 4 forces the `watcher` wait strategy
  with it, so a chart resource that never reaches kstatus Current (an unbound
  PVC, a stuck hook Job) fails and rolls back every run. All eight current
  callers have existing releases; only brand-new environments meet the first.
- **Environments are restricted to `main` by policy, not by the workflow.** The
  workflow cannot know which branches a caller trusts, so the restriction lives
  on the environment (deployment branch policy `main`, set via the API; the
  README shows the commands). Verified on boards `dev8` on 2026-09-09: Team
  plan accepts branch policies; required reviewers remain Enterprise-only.
- Deferred: OCI chart source (`oci://quay.io/huddo/<chart> --version`) — passes
  through `chart` + `helm_args` today, revisit with devops `FUTURE-chart-release-pipeline.md`;
  multiple `--values` files (needed once secret and non-secret values split);
  SOPS for the values files; deleting `deploy-gcloud.yaml` /
  `deploy-helm-in-isw.yaml` from devops once all eight callers are moved.
