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
