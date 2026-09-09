# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Purpose

This is `isw-kudos/github-actions` — the canonical source of reusable GitHub Actions and workflows for Docker builds, ECS deployments, and IaC validation. Each workflow is independently versioned (see `docs/per-component-versioning.md`). Consumers reference it directly by component tag.

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

### Versioning & Releases

Each externally consumed component is independently versioned with a semver tag prefix and released by semantic-release on push to `main`:

| Component | Tag prefix |
|---|---|
| `docker-build` | `docker-build-v` |
| `docker-build-ghcr` | `docker-build-ghcr-v` |
| `helm-deploy` | `helm-deploy-v` |
| `ecs-deploy` | `ecs-deploy-v` (also covers `.github/actions/ecs-query/**`) |
| `determine-image-digest` | `determine-image-digest-v` |
| `tofu-pre-commit` | `tofu-pre-commit-v` |
| `wait-for-required-checks` | `wait-for-required-checks-v` |
| `claude-code-review` | `claude-code-review-v` |
| `turbo-repo-cache` | `turbo-repo-cache-v` |
| `retag-images-ghcr` | `retag-images-ghcr-v` |

Use the matching Conventional Commit scope (`feat(ecs-deploy): ...`, `fix(docker-build): ...`, `chore(turbo-repo-cache): ...`) so commits land in the correct release. Renovate dependency bumps are committed as `chore(<component>): ...`; human bug fixes use `fix(<component>): ...`. Full mechanics — release workflows, Renovate `packageRules` wiring, bump rules, the `ecs-query`/`ecs-deploy` runtime caveat, and steps to add a new component — live in the `per-component-versioning` skill (`.claude/skills/per-component-versioning/SKILL.md`) and `docs/per-component-versioning.md`. Load the skill whenever working on releases, Renovate scope rules, or component additions.

### Reusable Workflows

| Workflow | Purpose |
|---|---|
| `docker-build.yml` | Build & push to ECR with multi-platform support and metadata tagging |
| `docker-build-ghcr.yml` | Build & push to ghcr.io from the workspace context, checking out private submodules via a GitHub App token when `.gitmodules` exists |
| `ecs-deploy.yml` | Deploy to ECS with SSM parameter backup and automatic rollback on failure |
| `helm-deploy.yml` | Generic `helm upgrade --install` to GKE (Workload Identity) or any kubeconfig-reachable cluster, chart and values read from a config repo |
| `determine-image-digest.yml` | Resolve ECR image digest for a given tag |
| `retag-images-ghcr.yml` | Point one tag at another across a list of ghcr.io images with `crane tag`: no layer pull, digest and OCI index preserved, every source resolved before any tag moves |
| `pre-commit.yml` | Standard pre-commit checks (whitespace, YAML, secret scanning via gitleaks) |
| `tofu-pre-commit.yml` | IaC pre-commit with OpenTofu, Terraform Docs, and Trivy vulnerability scanning |
| `zizmor.yml` | Static security audit of all workflows/actions (zizmor); fails CI on findings |

### Workflow Security

GitHub Actions workflows are validated by zizmor at three layers, all pinned to the same CLI version (Renovate bumps all three):

1. **CI** — `.github/workflows/zizmor.yml` runs on every `.github/workflows/**` / `.github/actions/**` change and on push to `main` (`persona: regular`, fails on findings).
2. **pre-commit** — the `zizmor` hook in `.pre-commit-config.yaml` audits staged workflow files (offline, regular persona).
3. **Claude hook** — `.claude/hooks/zizmor-check.sh` (PostToolUse) re-audits any workflow file Claude edits.

Load the `gha-security` skill (`.claude/skills/gha-security/SKILL.md`) before creating or editing anything under `.github/workflows/` or `.github/actions/` — it covers SHA pinning, trigger selection, least-privilege permissions (including `permission-*` inputs on `create-github-app-token`), and the env-var indirection rule for `run:` blocks. Never fix a zizmor failure by silencing it; fix the workflow or add a justified `# zizmor: ignore[rule]` comment.

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

<!-- BEGIN ISW AGENT STANDARDS (managed by import.mjs) -->
## ISW Agent Standards

Imported modules: agent-workflow, universal-code, code-minimalism, ci-github.

Before editing a file, consult the rules in `.claude/rules/` whose frontmatter
`paths:` globs match that file (rules with no `paths:` are always in effect).
Use the skills in `.claude/skills/` (git, commit, branch, pr, plan, …) for their tasks.

Update or re-sync these standards with:
```
node <path-to>/agent-standards/tools/import.mjs --update
```
<!-- END ISW AGENT STANDARDS -->
