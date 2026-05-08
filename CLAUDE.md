# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Purpose

This is `ISW-Cloud42/github-actions` — the canonical source of reusable GitHub Actions and workflows for Docker builds, ECS deployments, and IaC validation. Each workflow is independently versioned (see `docs/per-component-versioning.md`).

### Mirror/Sync Model

GitHub Actions cannot be consumed across organization boundaries when the source repo is private. This repo is therefore mirrored on every push to each consuming org by `.github/workflows/sync-mirrors.yml`. Consumers reference the mirror in their own org, e.g. `uses: <org>/github-actions/.github/workflows/docker-build.yml@docker-build-v1.0.0`.

Current mirror targets (matrix in `sync-mirrors.yml`):
- `ISW-AISP/github-actions`
- `isw-kudos/github-actions`

The sync uses the `devops-isw` GitHub App (`vars.DEVOPS_ISW_APP_ID` / `secrets.DEVOPS_ISW_APP_PRIVATE_KEY`); the same app must be installed in any new target org with access to a `github-actions` repo. Sync is force-push with `--prune` and pushes all branches and tags.

When adding a new mirror org: install the app, create the empty `github-actions` repo in the org, then add the org to the matrix. Update `README.md` mirror list too.

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
- **`releases/`** — Per-component semantic-release configs (see `docs/per-component-versioning.md`).

### Reusable Workflows

| Workflow | Purpose |
|---|---|
| `docker-build.yml` | Build & push to ECR with multi-platform support and metadata tagging |
| `ecs-deploy.yml` | Deploy to ECS with SSM parameter backup and automatic rollback on failure |
| `determine-image-digest.yml` | Resolve ECR image digest for a given tag |
| `pre-commit.yml` | Standard pre-commit checks (whitespace, YAML, secret scanning via gitleaks) |
| `tofu-pre-commit.yml` | IaC pre-commit with OpenTofu, Terraform Docs, and Trivy vulnerability scanning |
| `sync-mirrors.yml` | Mirror repo to consumer orgs (matrix: `ISW-AISP`, `isw-kudos`) on every push |

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
