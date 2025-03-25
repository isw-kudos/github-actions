# GitHub Actions

This repository contains reusable GitHub Actions for CI/CD, infrastructure automation, and other DevOps tasks. These actions can be shared across multiple repositories to maintain consistency and reduce duplication.

## 📌 Why Use This Repository?
- **Reusability** – Centralized actions reduce duplication across repositories.
- **Consistency** – Ensures uniform CI/CD practices across projects.
- **Maintainability** – Updates to actions propagate to all using repositories.

## 🚀 Usage

To use an action from this repository in another GitHub Actions workflow, reference it using the `uses` keyword:

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Docker Build
        uses: ISW-Cloud42/github-actions/docker-build-ecr@main
        with:
          aws_region: ${{ vars.aws_region }}
          aws_role_arn: ${{ vars.aws_role_arn }}
          ecr_registry: ${{ vars.ecr_registry }}
          ecr_repository: ${{ vars.ecr_repository }}
          ecr_cache_repository: ${{ vars.ecr_cache_repository }}
          tag: ${{ vars.tag }}
```
