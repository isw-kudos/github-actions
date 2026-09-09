# GitHub Actions

This repository contains reusable GitHub Actions for CI/CD, infrastructure automation, and other DevOps tasks. These actions can be shared across multiple repositories to maintain consistency and reduce duplication.

## 📌 Why Use This Repository?
- **Reusability** – Centralized actions reduce duplication across repositories.
- **Consistency** – Ensures uniform CI/CD practices across projects.
- **Maintainability** – Updates to actions propagate to all using repositories.

## 🏷️ Versioning & Releases

Each reusable workflow/action is an independently versioned **component** with its own semver tag prefix (e.g. `docker-build-v1.2.3`, `ecs-deploy-v1.2.3`). This means consumers only see updates when the specific component they use actually changes.

Releases are fully automated by [semantic-release](https://github.com/semantic-release/semantic-release):

- A per-component release workflow (`release-<component>.yml`) triggers on push to `main` with a `paths:` filter scoped to that component's files.
- semantic-release inspects [Conventional Commits](https://www.conventionalcommits.org/) since the last tag for that component to compute the next version, creates a git tag, and publishes a GitHub Release.
- Renovate dependency PRs use component-scoped commit messages (e.g. `fix(docker-build): ...`) so bot updates trigger the correct component release.

Bump rules:

| Commit type | Bump | Example |
|---|---|---|
| `feat!:` / `BREAKING CHANGE:` | Major | `feat(docker-build)!: remove architecture input` |
| `feat:` | Minor | `feat(ecs-deploy): add rollback timeout parameter` |
| `fix:` / `perf:` / `chore(deps):` | Patch | `fix(tofu-pre-commit): pin trivy version` |

Every component version is published as a GitHub Release. Full details, Renovate config for consumers, and the steps to add a new component are in [Per-Component Versioning](docs/per-component-versioning.md).

## 🚀 Usage

### Reusable Workflows

Pin each `uses:` to a full commit SHA (shown below as `<dummy hash>`) rather than a tag or `@main`. Replace `<dummy hash>` with the commit SHA of the [release](../../releases) you want — each component is released under its own tag prefix (e.g. `docker-build-v1.2.3`), and the release page shows the matching SHA.

#### docker-build
A comprehensive Docker build workflow with ECR integration.

```yaml
jobs:
  build:
    uses: isw-kudos/github-actions/.github/workflows/docker-build.yml@<dummy hash>
    with:
      environment: production
      architecture: linux/amd64
      enable_caching: true
      push: true
```

#### docker-build-ghcr
Builds from the checked-out workspace (so `.dockerignore` applies) and pushes `ghcr.io/<owner>/<image>:<tag>` with a registry build cache. When the calling repo has a `.gitmodules` file, it mints a GitHub App token scoped to the calling repo and its same-owner submodules to check them out; the app client id comes from the caller's `HUDDO_DEVOPS_GITHUB_APP_ID` variable. Grant exactly `contents: read` and `packages: write` on the calling job; a smaller grant fails the run at startup.

```yaml
jobs:
  build:
    permissions:
      contents: read
      packages: write
    uses: isw-kudos/github-actions/.github/workflows/docker-build-ghcr.yml@<dummy hash>
    with:
      dockerfile_path: apps/core/Dockerfile
      image: boards-core
      tag: ${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || github.ref_name }}
    secrets: # only when the repo has a private submodule
      HUDDO_DEVOPS_GITHUB_APP_PRIVATE_KEY: ${{ secrets.HUDDO_DEVOPS_GITHUB_APP_PRIVATE_KEY }}
```

#### ecs-deploy
Deploys applications to Amazon ECS with automatic rollback on failure.

```yaml
jobs:
  deploy:
    uses: isw-kudos/github-actions/.github/workflows/ecs-deploy.yml@<dummy hash>
    with:
      environment: production
      cluster_name: my-cluster
      service_name: my-service
      container_name: my-container
      tag: latest
      ssm_parameter_name: /my-app/image-digest
```

#### helm-deploy
Generic `helm upgrade --install`. `target` picks the cluster auth (`gke` via Workload Identity Federation, `kubeconfig` via a `KUBECONFIG` secret, e.g. an on-prem cluster reachable only from a self-hosted runner) and `runner` picks where the job runs. The chart and values file are read from `config_repository` (the calling repo when empty); a different repo is checked out with a GitHub App token scoped to it, client id from the caller's `HUDDO_DEVOPS_GITHUB_APP_ID` variable. Waits for the rollout and rolls back on failure by default (`wait: false` to opt out). Grant exactly `contents: read` and `id-token: write` on the calling job.

The deploy job runs inside the GitHub Environment named by `environment`, so each run is recorded under the caller's Environments tab. GitHub creates the environment on first use with no restrictions; since these jobs change real infrastructure, restrict each one so only `main` can deploy to it (deployment branch policies are available on Team plan private repos; required reviewers are not):

```bash
gh api -X PUT repos/<owner>/<repo>/environments/<env> \
  --input - <<< '{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}'
gh api -X POST repos/<owner>/<repo>/environments/<env>/deployment-branch-policies -f name=main -f type=branch
```

A `workflow_dispatch` from any other branch then fails at job start with "Branch ... is not allowed to deploy to <env>" before anything is checked out.

```yaml
jobs:
  deploy-gke:
    permissions:
      contents: read
      id-token: write
    uses: isw-kudos/github-actions/.github/workflows/helm-deploy.yml@<dummy hash>
    with:
      runner: gcloud
      target: gke
      environment: staging
      gcp_project: ${{ vars.GCP_PROJECT }}
      gke_cluster: staging
      gke_location: australia-southeast2
      gcp_workload_identity_provider: ${{ vars.GCP_WORKLOAD_IDENTITY_PROVIDER }}
      gcp_service_account: ${{ vars.GCP_SERVICE_ACCOUNT }}
      config_repository: isw-kudos/devops
      chart: ./helm-charts/huddo-boards-2.2.0.tgz
      values: ./boards/staging.yaml
      namespace: boards
      release_name: staging-boards
      helm_args: --set core.image.tag=pr-123
    secrets:
      HUDDO_DEVOPS_GITHUB_APP_PRIVATE_KEY: ${{ secrets.HUDDO_DEVOPS_GITHUB_APP_PRIVATE_KEY }}

  deploy-onprem:
    permissions:
      contents: read
      id-token: write
    uses: isw-kudos/github-actions/.github/workflows/helm-deploy.yml@<dummy hash>
    with:
      runner: isw
      target: kubeconfig
      environment: dev8
      config_repository: isw-kudos/devops
      chart: ./helm-charts/huddo-cp-1.1.2.tgz
      values: ./collab/dev8.yaml
      namespace: connections
      release_name: huddo-cp
    secrets:
      HUDDO_DEVOPS_GITHUB_APP_PRIVATE_KEY: ${{ secrets.HUDDO_DEVOPS_GITHUB_APP_PRIVATE_KEY }}
      KUBECONFIG: ${{ secrets.DEV8_KUBE_CONFIG }}
```

#### tofu-pre-commit
A comprehensive pre-commit workflow with OpenTofu/Terraform tooling including Go, Terraform Docs, Trivy, and OpenTofu setup.

```yaml
jobs:
  pre-commit:
    uses: isw-kudos/github-actions/.github/workflows/tofu-pre-commit.yml@<dummy hash>
```

#### determine-image-digest
Resolves the ECR image digest for a given tag.

```yaml
jobs:
  digest:
    uses: isw-kudos/github-actions/.github/workflows/determine-image-digest.yml@<dummy hash>
```

#### turbo-repo-cache
Composite action. Authenticates to GCP via OIDC and starts a local Turborepo remote-cache server backed by a GCS bucket. Subsequent `turbo` commands in the job use the local cache.

```yaml
steps:
  - uses: isw-kudos/github-actions/.github/actions/turbo-repo-cache@<dummy hash>
    with:
      workload-identity-provider: projects/123/locations/global/workloadIdentityPools/POOL/providers/PROVIDER
      service-account: my-sa@my-project.iam.gserviceaccount.com
      storage-path: my-turborepo-cache-bucket
```
