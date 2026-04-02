# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Purpose

This is `ISW-Cloud42/github-actions` — a collection of reusable GitHub Actions and workflows for Docker builds, ECS deployments, and IaC validation. Actions are referenced by other repositories via `uses: ISW-Cloud42/github-actions/<action>@main`.

## Commands

### ecs-query Python Action

```bash
# Install dependencies
pip install -r .github/actions/ecs-query/requirements.txt

# Run all tests
pytest .github/actions/ecs-query/tests/

# Run a single test file
pytest .github/actions/ecs-query/tests/test_services.py

# Run a single test
pytest .github/actions/ecs-query/tests/test_services.py::test_name

# Build Docker image
docker build -t ecs-query .github/actions/ecs-query/

# Run action locally (set required env vars first)
export INPUT_QUERY_TYPE=services
export INPUT_CLUSTER=my-cluster
export INPUT_AWS_REGION=ap-southeast-2
python3 .github/actions/ecs-query/src/main.py
```

### Pre-commit

```bash
pre-commit run --all-files
```

## Architecture

### Repository Layout

- **`.github/actions/ecs-query/`** — Docker-based custom Python action for querying AWS ECS (services, tasks, deployments, deployment validation).
- **`.github/workflows/`** — Reusable workflows called from other repos.
- **`docker-build-ecr/action.yml`** — Composite action that builds and pushes Docker images to AWS ECR using Docker BuildX with ECR caching and OIDC auth.
- **`set-env-vars/action.yml`** — Composite action that exports variables with a specific prefix (e.g., `PROD_`) to the GitHub environment context. Used as an alternative to GitHub Deployment Environments.

### Reusable Workflows

| Workflow | Purpose |
|---|---|
| `docker-build.yml` | Build & push to ECR with multi-platform support and metadata tagging |
| `ecs-deploy.yml` | Deploy to ECS with SSM parameter backup and automatic rollback on failure |
| `determine-image-digest.yml` | Resolve ECR image digest for a given tag |
| `pre-commit.yml` | Standard pre-commit checks (whitespace, YAML, secret scanning via gitleaks) |
| `tofu-pre-commit.yml` | IaC pre-commit with OpenTofu, Terraform Docs, and Trivy vulnerability scanning |
| `sync-mirrors.yml` | Mirror repo to ISW-AISP |

### ecs-deploy Rollback Flow

The `ecs-deploy.yml` workflow:
1. Backs up the current image digest to SSM parameter store
2. Updates ECS task definition with the new image digest
3. Waits up to 20 minutes for ECS service stability
4. Validates deployment via the `ecs-query` action (checks `check-deployment` query type)
5. On failure, restores the previous SSM value and triggers a rollback deployment

### ecs-query Action

Python modules under `.github/actions/ecs-query/src/`:
- `main.py` — Entry point; parses GitHub Actions inputs, dispatches to query modules, formats and sets outputs
- `queries/services.py` — ECS service listing with filtering
- `queries/tasks.py` — ECS task listing with filtering
- `queries/deployments.py` — Deployment listing, ARN enrichment, and `check-deployment` validation logic
- `utils/aws_client.py` — boto3 ECS client initialization
- `utils/formatters.py` — Output formats: `json`, `table`, `summary`, `compact`
- `utils/encoders.py` — Custom JSON encoder for AWS types (`datetime`, `Decimal`)

Query types: `services`, `tasks`, `deployments`, `check-deployment`

### AWS Authentication

All AWS access uses OIDC (no long-lived credentials). Workflows assume an IAM role via `aws-actions/configure-aws-credentials`.

### Python Version

Python `3.14.3` (specified in `.python-version`). Dependencies are pinned in `.github/actions/ecs-query/requirements.txt` and updated automatically by Renovate (minor/patch auto-merged after 3-day minimum age).
