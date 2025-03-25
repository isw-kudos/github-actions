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

Usage From another organisation:

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Generate App Token
        uses: actions/create-github-app-token@v1
        id: app_token
        with:
          app-id: ${{ vars.DEPLOY_APP_ID }}
          private-key: ${{ secrets.DEPLOY_APP_PRIVATE_KEY }}
          owner: ISW-Cloud42
          repositories: github-actions

      - name: Checkout reusable workflows
        uses: actions/checkout@v4
        with:
          ref: main
          repository: ISW-Cloud42/github-actions
          token: ${{ steps.app_token.outputs.token }}
          path: .

      - name: Docker Build
        uses: ./actions/docker-build-ecr
        with:
          aws_region: ${{ vars.aws_region }}
          aws_role_arn: ${{ vars.aws_role_arn }}
          ecr_registry: ${{ vars.ecr_registry }}
          ecr_repository: ${{ vars.ecr_repository }}
          ecr_cache_repository: ${{ vars.ecr_cache_repository }}
          tag: ${{ vars.tag }}
```
