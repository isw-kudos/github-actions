# GitHub Actions

This repository contains reusable GitHub Actions for CI/CD, infrastructure automation, and other DevOps tasks. These actions can be shared across multiple repositories to maintain consistency and reduce duplication.

## 📌 Why Use This Repository?
- **Reusability** – Centralized actions reduce duplication across repositories.
- **Consistency** – Ensures uniform CI/CD practices across projects.
- **Maintainability** – Updates to actions propagate to all using repositories.

## 🪞 Mirroring Model

GitHub Actions cannot be consumed from private repositories outside the owning organization. To work around this, this canonical repository (`ISW-Cloud42/github-actions`) is automatically mirrored to each consuming organization by the [`sync-mirrors.yml`](.github/workflows/sync-mirrors.yml) workflow on every push.

Currently mirrored to:
- `ISW-AISP/github-actions`
- `isw-kudos/github-actions`

**Consumers must reference the mirror in their own organization, not this canonical repo.** Replace `<org>` in the examples below with your organization's name (e.g. `ISW-AISP`, `isw-kudos`).

To add a new org as a mirror target:
1. Install the `devops-isw` GitHub App in the new org with access to a `github-actions` repository.
2. Create the empty `github-actions` repository in that org.
3. Add the org to the matrix in [`.github/workflows/sync-mirrors.yml`](.github/workflows/sync-mirrors.yml).

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

Tags are pushed to all mirror orgs by `sync-mirrors.yml`, so consumers referencing `<org>/github-actions@<component>-vX.Y.Z` get the same versions as the canonical repo. Full details, Renovate config for consumers, and the steps to add a new component are in [Per-Component Versioning](docs/per-component-versioning.md).

## 🚀 Usage

### Reusable Workflows

Pin to a component tag (not `@main` or a commit SHA). Each example below uses the component's tag prefix.

#### docker-build
A comprehensive Docker build workflow with ECR integration.

```yaml
jobs:
  build:
    uses: <org>/github-actions/.github/workflows/docker-build.yml@docker-build-v1.0.0
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
    uses: <org>/github-actions/.github/workflows/ecs-deploy.yml@ecs-deploy-v1.0.0
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
    uses: <org>/github-actions/.github/workflows/tofu-pre-commit.yml@tofu-pre-commit-v1.0.0
```

#### determine-image-digest
Resolves the ECR image digest for a given tag.

```yaml
jobs:
  digest:
    uses: <org>/github-actions/.github/workflows/determine-image-digest.yml@determine-image-digest-v1.0.0
```
