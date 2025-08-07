# GitHub Actions

This repository contains reusable GitHub Actions for CI/CD, infrastructure automation, and other DevOps tasks. These actions can be shared across multiple repositories to maintain consistency and reduce duplication.

## 📌 Why Use This Repository?
- **Reusability** – Centralized actions reduce duplication across repositories.
- **Consistency** – Ensures uniform CI/CD practices across projects.
- **Maintainability** – Updates to actions propagate to all using repositories.

## 🚀 Usage

### Actions

This repository provides the following reusable actions:

#### docker-build-ecr
Builds and pushes Docker images to Amazon ECR with caching support.

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Docker Build ECR
        uses: ISW-Cloud42/github-actions/docker-build-ecr@main
        with:
          aws_region: ${{ vars.aws_region }}
          aws_role_arn: ${{ vars.aws_role_arn }}
          ecr_registry: ${{ vars.ecr_registry }}
          ecr_repository: ${{ vars.ecr_repository }}
          ecr_cache_repository: ${{ vars.ecr_cache_repository }}
          tag: ${{ vars.tag }}
```

#### set-env-vars
Exports variables with a specific prefix to the environment context.

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Set Environment Variables
        uses: ISW-Cloud42/github-actions/set-env-vars@main
        with:
          environment_prefix: PROD
          secrets_context: ${{ toJSON(secrets) }}
          vars_context: ${{ toJSON(vars) }}
```

### Reusable Workflows

This repository also provides reusable workflows:

#### docker-build
A comprehensive Docker build workflow with ECR integration.

```yaml
jobs:
  build:
    uses: ISW-Cloud42/github-actions/.github/workflows/docker-build.yml@main
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
    uses: ISW-Cloud42/github-actions/.github/workflows/ecs-deploy.yml@main
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
    uses: ISW-Cloud42/github-actions/.github/workflows/tofu-pre-commit.yml@main
```

### Usage From Another Organisation

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

      - name: Docker Build ECR
        uses: ./docker-build-ecr
        with:
          aws_region: ${{ vars.aws_region }}
          aws_role_arn: ${{ vars.aws_role_arn }}
          ecr_registry: ${{ vars.ecr_registry }}
          ecr_repository: ${{ vars.ecr_repository }}
          ecr_cache_repository: ${{ vars.ecr_cache_repository }}
          tag: ${{ vars.tag }}

      - name: Set Environment Variables
        uses: ./set-env-vars
        with:
          environment_prefix: PROD
          secrets_context: ${{ toJSON(secrets) }}
          vars_context: ${{ toJSON(vars) }}
```
