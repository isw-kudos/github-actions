# Per-Component Versioning

This repo uses per-component semantic versioning so that consuming repos only receive update notifications when the specific workflow or action they use actually changes.

## How it works

Each externally consumed workflow/action is a **component** with its own semver tag (e.g. `docker-build-v1.2.3`). When a component's files change on `main`, a dedicated release workflow runs [semantic-release](https://github.com/semantic-release/semantic-release) to determine the next version, create a git tag, and publish a GitHub Release.

The primary scoping mechanism is the `paths:` filter on each release workflow. If the workflow triggers, the component changed, and a version bump is warranted.

## Components

| Component | Tag prefix | Watched paths | Consumers |
|---|---|---|---|
| docker-build | `docker-build-v` | `.github/workflows/docker-build.yml` | erc-api-v1, erc-web, erc-pdf |
| ecs-deploy | `ecs-deploy-v` | `.github/workflows/ecs-deploy.yml`, `.github/actions/ecs-query/**` | erc-api-v1, erc-web, erc-pdf |
| determine-image-digest | `determine-image-digest-v` | `.github/workflows/determine-image-digest.yml` | erc-pdf |
| tofu-pre-commit | `tofu-pre-commit-v` | `.github/workflows/tofu-pre-commit.yml` | nat-instance, aws-alb, aws-ecs, aws-instance, aws-vpc, mongo-atlas |
| wait-for-required-checks | `wait-for-required-checks-v` | `.github/actions/wait-for-required-checks/**` | erc-pdf |

## Version bump rules

Version bumps are determined by [conventional commit](https://www.conventionalcommits.org/) messages:

| Commit type | Version bump | Example |
|---|---|---|
| `BREAKING CHANGE:` / `!` | Major | `feat(docker-build)!: remove architecture input` |
| `feat` | Minor | `feat(ecs-deploy): add rollback timeout parameter` |
| `fix` / `perf` | Patch | `fix(tofu-pre-commit): pin trivy version` |
| `chore(deps)` | Patch | `chore(deps): update actions/checkout` |
| Anything else | Patch | Catch-all safety net |

### Scoped commits

Renovate is configured to use component-scoped commit messages (e.g. `fix(docker-build): update docker/build-push-action`). This is done via `semanticCommitScope` rules in `renovate.json`.

Human commits should follow the same convention where practical. If a commit lacks a scope, the catch-all rule still creates a patch release -- no changes are ever missed.

## Consuming a versioned workflow

Pin to a component tag instead of a commit SHA or `@main`:

```yaml
# Recommended: pin to a component tag
uses: ISW-AISP/github-actions/.github/workflows/docker-build.yml@docker-build-v1.2.3

# Or via ISW-Cloud42 directly
uses: ISW-Cloud42/github-actions/.github/workflows/tofu-pre-commit.yml@tofu-pre-commit-v1.0.0
```

### Renovate config for consuming repos

Add `extractVersion` rules so Renovate tracks the correct tag pattern per workflow:

```json
{
  "packageRules": [
    {
      "matchDepNames": ["ISW-AISP/github-actions"],
      "matchFileNames": [".github/workflows/build.yml"],
      "extractVersion": "^docker-build-v(?<version>.*)$"
    },
    {
      "matchDepNames": ["ISW-AISP/github-actions"],
      "matchFileNames": [".github/workflows/deploy.yml"],
      "extractVersion": "^ecs-deploy-v(?<version>.*)$"
    }
  ]
}
```

Adjust `matchFileNames` to match the actual workflow file in the consuming repo that references the shared workflow.

## Mirror sync

Tags are automatically pushed to the `ISW-AISP/github-actions` mirror via `sync-mirrors.yml`. Consumers referencing `ISW-AISP/github-actions` will see the same tags as `ISW-Cloud42/github-actions`.

## Architecture

### Release config

Each component has a `.releaserc.yaml` in `releases/<component>/`:

```
releases/
  docker-build/.releaserc.yaml
  ecs-deploy/.releaserc.yaml
  determine-image-digest/.releaserc.yaml
  tofu-pre-commit/.releaserc.yaml
```

All configs are identical except for the `tagFormat` value. They use plain `semantic-release` (not `semantic-release-monorepo`) because the reusable workflows share the `.github/workflows/` directory, which prevents directory-based commit filtering.

### Release workflows

Each component has a release workflow in `.github/workflows/release-<component>.yml` that:

1. Triggers on push to `main` with a `paths:` filter scoped to the component's files
2. Runs `npx semantic-release` from the component's `releases/<component>/` directory
3. Creates a git tag and GitHub Release via `@semantic-release/github`

### Internal-only workflows (not versioned)

| Workflow | Purpose |
|---|---|
| `pre-commit.yml` | Runs pre-commit checks on this repo's PRs |
| `abom.yml` | ABOM supply chain security scan |
| `sync-mirrors.yml` | Syncs branches and tags to ISW-AISP |
| `release-*.yml` | Per-component release automation |

### Renovate scoping in this repo

`renovate.json` maps dependency files to component scopes:

| Files | Scope | Resulting commit format |
|---|---|---|
| `.github/workflows/docker-build.yml` | `docker-build` | `fix(docker-build): ...` |
| `.github/workflows/ecs-deploy.yml` | `ecs-deploy` | `fix(ecs-deploy): ...` |
| `.github/actions/ecs-query/**` | `ecs-deploy` | `fix(ecs-deploy): ...` |
| `.github/workflows/determine-image-digest.yml` | `determine-image-digest` | `fix(determine-image-digest): ...` |
| `.github/workflows/tofu-pre-commit.yml` | `tofu-pre-commit` | `fix(tofu-pre-commit): ...` |
| `.github/actions/wait-for-required-checks/**` | `wait-for-required-checks` | `fix(wait-for-required-checks): ...` |
| Other files | Default (`deps`) | `chore(deps): ...` |

## Adding a new component

1. Create `releases/<component>/.releaserc.yaml` with the appropriate `tagFormat`
2. Create `.github/workflows/release-<component>.yml` with `paths:` filter for the component's files
3. Add a `matchFileNames` rule to `renovate.json` to scope dependency updates
4. Seed an initial tag: `git tag <component>-v1.0.0 && git push origin --tags`

## Known trade-offs

### Version inflation

semantic-release analyses all commits since the last component tag, not just those touching the component's files. If an unrelated `feat:` commit lands between two tags, the component may get a minor bump instead of a patch. This is cosmetic -- consumers always get the correct code. In practice it rarely occurs because most commits are Renovate `fix(<component>):` patches.

### ecs-deploy runtime behaviour

`ecs-deploy.yml` checks out this repo from `ref: main` at runtime to access the `ecs-query` action. The version tag only controls the workflow YAML -- the `ecs-query` action code is always pulled from latest `main`.
