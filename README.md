# GitHub Actions

This repository contains reusable GitHub Actions for CI/CD, infrastructure automation, and other DevOps tasks. These actions can be shared across multiple repositories to maintain consistency and reduce duplication.

## 📌 Why Use This Repository?
- **Reusability** – Centralized actions reduce duplication across repositories.
- **Consistency** – Ensures uniform CI/CD practices across projects.
- **Maintainability** – Updates to actions propagate to all using repositories.

## 🚀 Usage

### Reusable Workflows

This repository provides the following reusable workflows. Each is independently versioned — see [Per-Component Versioning](docs/per-component-versioning.md) for details.

#### docker-build
A comprehensive Docker build workflow with ECR integration.

```yaml
jobs:
  build:
    uses: ISW-Cloud42/github-actions/.github/workflows/docker-build.yml@docker-build-v1.0.0
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
    uses: ISW-Cloud42/github-actions/.github/workflows/ecs-deploy.yml@ecs-deploy-v1.0.0
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
    uses: ISW-Cloud42/github-actions/.github/workflows/tofu-pre-commit.yml@tofu-pre-commit-v1.0.0
```

#### determine-image-digest
Resolves the ECR image digest for a given tag.

```yaml
jobs:
  digest:
    uses: ISW-Cloud42/github-actions/.github/workflows/determine-image-digest.yml@determine-image-digest-v1.0.0
```
