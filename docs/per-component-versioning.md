# Per-Component Versioning

This repo uses per-component semantic versioning so that consuming repos only receive update notifications when the specific workflow or action they use actually changes.

## How it works

Each externally consumed workflow/action is a **component** with its own semver tag (e.g. `docker-build-v1.2.3`). When a component's files change on `main`, a dedicated release workflow runs [semantic-release](https://github.com/semantic-release/semantic-release) to determine the next version, create a git tag, and publish a GitHub Release.

The primary scoping mechanism is the `paths:` filter on each release workflow. If the workflow triggers, the component changed, and a version bump is warranted.

## Components

| Component | Tag prefix | Watched paths | Consumers |
|---|---|---|---|
| docker-build | `docker-build-v` | `.github/workflows/docker-build.yml` | erc-api-v1, erc-web, erc-pdf |
| docker-build-ghcr | `docker-build-ghcr-v` | `.github/workflows/docker-build-ghcr.yml` | boards, collab, huddo-services (migrating from `isw-kudos/devops` `docker-build-generic.yml`) |
| helm-deploy | `helm-deploy-v` | `.github/workflows/helm-deploy.yml` | boards, collab (migrating from `isw-kudos/devops` `deploy-gcloud.yaml` / `deploy-helm-in-isw.yaml`) |
| ecs-deploy | `ecs-deploy-v` | `.github/workflows/ecs-deploy.yml`, `.github/actions/ecs-query/**` | erc-api-v1, erc-web, erc-pdf |
| determine-image-digest | `determine-image-digest-v` | `.github/workflows/determine-image-digest.yml` | erc-pdf |
| tofu-pre-commit | `tofu-pre-commit-v` | `.github/workflows/tofu-pre-commit.yml` | nat-instance, aws-alb, aws-ecs, aws-instance, aws-vpc, mongo-atlas |
| wait-for-required-checks | `wait-for-required-checks-v` | `.github/actions/wait-for-required-checks/**` | erc-pdf |
| claude-code-review | `claude-code-review-v` | `.github/workflows/claude-code-review.yml` | (internal review automation) |
| turbo-repo-cache | `turbo-repo-cache-v` | `.github/actions/turbo-repo-cache/**` | huddo (Turborepo monorepo CI) |
| retag-images-ghcr | `retag-images-ghcr-v` | `.github/workflows/retag-images-ghcr.yml` | boards, collab (replacing the `isw-kudos/devops` `retag-image` composite action) |
| cleanup-images-ghcr | `cleanup-images-ghcr-v` | `.github/workflows/cleanup-images-ghcr.yml` | boards, collab, huddo-services (scheduled ghcr.io package cleanup) |

## Version bump rules

Version bumps are determined by [conventional commit](https://www.conventionalcommits.org/) messages:

| Commit type | Version bump | Example |
|---|---|---|
| `BREAKING CHANGE:` / `!` with component scope | Major | `feat(docker-build)!: remove architecture input` |
| `feat(<component>)` | Minor | `feat(ecs-deploy): add rollback timeout parameter` |
| `fix(<component>)` / `perf(<component>)` | Patch | `fix(tofu-pre-commit): pin trivy version` |
| `chore(<component>)` | Patch | `chore(ecs-deploy): update boto3` (Renovate dep bumps) |
| Any other scope | No release | Commits scoped to other components are ignored |

Use the `!` form for breaking changes. The repo squash-merges with the PR title
as the subject and a **blank body**, so a `BREAKING CHANGE:` footer written in a
branch commit never reaches `main`; only the `!` in the PR title survives. The
release config uses the `conventionalcommits` preset for exactly this reason:
the default `angular` preset cannot parse `type(scope)!:` at all and silently
produces no release (this bit `turbo-repo-cache` v2.0.0, re-released via
`workflow_dispatch`). Keep the PR title conventional; it becomes the commit.

### Scoped commits

Renovate is configured to use component-scoped commit messages (e.g. `chore(docker-build): update docker/build-push-action`). This is done via `semanticCommitScope` rules in `renovate.json`. Renovate uses `chore` rather than `fix` because dependency bumps are maintenance, not bug fixes.

Human commits should follow the same convention. Commits without a matching component scope do not trigger a release for that component.

### How Renovate triggers component bumps

`renovate.json` is the source of truth for how dependency updates map to component releases. Each `packageRules` entry that matches a component's files sets:

- `semanticCommitType: "chore"` → patch bump (use `feat` manually for new functionality so you get a minor; use `fix` manually for actual bug fixes)
- `semanticCommitScope: "<component>"` → directs the commit at the right component's release workflow
- `commitMessageSuffix: ""` → strips the default `(github-actions)` suffix so the commit subject stays a clean Conventional Commit (untouched suffixes still parse, but the empty override keeps history tidy)

Mapping currently in `renovate.json`:

| Path matched by Renovate | Resulting commit | Component released |
|---|---|---|
| `.github/workflows/docker-build.yml` | `chore(docker-build): ...` | docker-build (patch) |
| `.github/workflows/docker-build-ghcr.yml` | `chore(docker-build-ghcr): ...` | docker-build-ghcr (patch) |
| `.github/workflows/helm-deploy.yml` | `chore(helm-deploy): ...` | helm-deploy (patch) |
| `.github/workflows/ecs-deploy.yml` | `chore(ecs-deploy): ...` | ecs-deploy (patch) |
| `.github/actions/ecs-query/**` | `chore(ecs-deploy): ...` | ecs-deploy (patch) — ecs-query is part of the ecs-deploy component |
| `.github/workflows/determine-image-digest.yml` | `chore(determine-image-digest): ...` | determine-image-digest (patch) |
| `.github/workflows/tofu-pre-commit.yml` | `chore(tofu-pre-commit): ...` | tofu-pre-commit (patch) |
| `.github/actions/wait-for-required-checks/**` | `chore(wait-for-required-checks): ...` | wait-for-required-checks (patch) |
| `.github/workflows/claude-code-review.yml` | `chore(claude-code-review): ...` | claude-code-review (patch) |
| `.github/actions/turbo-repo-cache/**` | `chore(turbo-repo-cache): ...` | turbo-repo-cache (patch) |
| `.github/workflows/retag-images-ghcr.yml` | `chore(retag-images-ghcr): ...` | retag-images-ghcr (patch) |
| `.github/workflows/cleanup-images-ghcr.yml` | `chore(cleanup-images-ghcr): ...` | cleanup-images-ghcr (patch) |
| Anything else | `chore(deps): ... (github-actions)` | No component release (catch-all, but no `paths:` match) |

Other Renovate behaviours that affect release cadence:

- `minimumReleaseAge: "3 days"` (top-level) and `"14 days"` for `custom.regex` managers — Renovate waits this long after an upstream release before opening a PR, so most patch bumps land staggered rather than in bursts.
- `pinDigests: true` for the `github-actions` manager — action references are pinned by SHA in PRs (e.g. `actions/checkout@<sha> # v6.0.2`); the comment is what Renovate updates when the version moves, which is what triggers the next `chore(<component>)` PR.
- `automerge: true` for minor/patch updates outside `github-actions` and `custom.regex` managers — those merge themselves, which means the component's release workflow runs without human intervention. **Keep `paths:` filters tight on release workflows; otherwise an automerged dep could publish an unintended release.**
- `commitMessageSuffix: "(github-actions)"` is set globally for the github-actions manager but overridden to empty for every component-scoped rule. New scope rules added in future should also set `"commitMessageSuffix": ""` to keep release notes clean.

When adding a new component, you must add a matching `packageRules` entry to `renovate.json` — without it, Renovate updates to that component's files would commit as `chore(deps)` and miss the component's release workflow filter (or worse, trigger the wrong component's release if paths overlap).

## Consuming a versioned workflow

Pin to a component tag instead of a commit SHA or `@main`:

```yaml
# Recommended: pin to a component tag
uses: isw-kudos/github-actions/.github/workflows/docker-build.yml@docker-build-v1.2.3
```

### Renovate config for consuming repos

Pin by SHA with the component tag in the trailing comment, and let one regex
manager own every `isw-kudos/github-actions` reference:

```yaml
uses: isw-kudos/github-actions/.github/actions/turbo-repo-cache@<sha> # turbo-repo-cache-v2.0.0
uses: isw-kudos/github-actions/.github/workflows/docker-build.yml@<sha> # docker-build-v1.2.3
```

```json
{
  "customManagers": [
    {
      "customType": "regex",
      "description": "Track every isw-kudos/github-actions component pin; the component name is captured from the tag comment so new components need no config change.",
      "managerFilePatterns": ["/\\.github/workflows/.*\\.ya?ml$/"],
      "matchStrings": [
        "uses:\\s+isw-kudos/github-actions/(?<path>[^@\\s]+)@(?<currentDigest>[a-f0-9]{40})\\s+#\\s+(?<component>[a-z0-9-]+)-v(?<currentValue>\\d+\\.\\d+\\.\\d+)"
      ],
      "depNameTemplate": "isw-kudos/github-actions/{{{component}}}",
      "packageNameTemplate": "isw-kudos/github-actions",
      "datasourceTemplate": "github-tags",
      "extractVersionTemplate": "^{{{component}}}-v(?<version>.*)$",
      "versioningTemplate": "semver"
    }
  ],
  "packageRules": [
    {
      "description": "The regex manager owns these pins; the built-in manager reads the comment as an opaque ref and would only duplicate digest PRs.",
      "matchManagers": ["github-actions"],
      "matchPackageNames": ["isw-kudos/github-actions"],
      "enabled": false
    },
    {
      "description": "Our own semantic-released tags do not need the third-party quarantine.",
      "matchPackageNames": ["isw-kudos/github-actions"],
      "minimumReleaseAge": null
    }
  ]
}
```

Why this shape (verified with a Renovate 44.39 dry-run lookup, 2026-09-08):

- Renovate's built-in `github-actions` manager reads `# turbo-repo-cache-v1.0.0`
  as an opaque ref and resolves it through the `github-digest` datasource, so it
  can follow that one tag's digest but never proposes a version bump. Without
  the regex manager a consumer never sees a new component release.
- The regex manager captures `component` from the comment; `extractVersion`
  strips the prefix so semver ordering works, and the new digest comes from the
  matching tag. One manager covers every current and future component.
- Disabling the built-in manager for the package stops two managers claiming
  the same line (a re-pointed tag would otherwise open two PRs).
- A consumer's global `minimumReleaseAge` applies to these tags because the
  github-tags datasource reports release timestamps; the exemption avoids a
  multi-day hold on our own releases. Renovate shows a held update on the
  Dependency Dashboard under "Pending Status Checks".

Reference implementations: `isw-kudos/collab`, `isw-kudos/boards`,
`isw-kudos/huddo-services` (`renovate.json`).

## Architecture

### Release config

Each component has a `.releaserc.js` in `releases/<component>/`:

```
releases/
  docker-build/.releaserc.js
  docker-build-ghcr/.releaserc.js
  ecs-deploy/.releaserc.js
  determine-image-digest/.releaserc.js
  tofu-pre-commit/.releaserc.js
```

All configs share the same structure with a `scope` constant. Only commits whose `scope` matches the component's name trigger a release or appear in release notes — all other commits are ignored. They use plain `semantic-release` (not `semantic-release-monorepo`) because the reusable workflows share the `.github/workflows/` directory, which prevents directory-based commit filtering.

**`releaseRules` ordering matters**: the catch-all `{ release: false }` must be the FIRST rule. commit-analyzer lets a later-matching rule override an earlier match, and `release: false` outranks every release type — placed last, it matches every commit and suppresses all releases (this silently disabled every component release between May and August 2026).

### Release workflows

Each component has a release workflow in `.github/workflows/release-<component>.yml` that:

1. Triggers on push to `main` with a `paths:` filter scoped to the component's files (plus `workflow_dispatch` for manual catch-up runs)
2. Checks out the tip of `main` (`ref: main`), not the push SHA — semantic-release refuses to publish from a commit that is behind the remote branch ("The local branch main is behind the remote one"), which would silently drop a release whenever two PRs merge back-to-back
3. Runs `npx semantic-release` from the component's `releases/<component>/` directory
4. Creates a git tag and GitHub Release via `@semantic-release/github`

If a release was still skipped by a race (a push landed between checkout and semantic-release), trigger the component's release workflow manually via `workflow_dispatch` — it analyses the tip of `main` and releases any unreleased scoped commits.

### Commit-msg hook

`.github/scripts/check-component-scope.sh` runs as a `commit-msg` pre-commit hook. It maps staged file paths to their required component scope and rejects the commit if the message scope doesn't match — preventing silent release misses. It must be kept in sync with the `paths:` filters in the release workflows.

Activate locally with:
```bash
pre-commit install --hook-type commit-msg
```

### Internal-only workflows (not versioned)

| Workflow | Purpose |
|---|---|
| `pre-commit.yml` | Runs pre-commit checks on this repo's PRs |
| `zizmor.yml` | Static security audit of workflows/actions |
| `release-*.yml` | Per-component release automation |

### Renovate scoping in this repo

`renovate.json` maps dependency files to component scopes:

| Files | Scope | Resulting commit format |
|---|---|---|
| `.github/workflows/docker-build.yml` | `docker-build` | `chore(docker-build): ...` |
| `.github/workflows/docker-build-ghcr.yml` | `docker-build-ghcr` | `chore(docker-build-ghcr): ...` |
| `.github/workflows/ecs-deploy.yml` | `ecs-deploy` | `chore(ecs-deploy): ...` |
| `.github/actions/ecs-query/**` | `ecs-deploy` | `chore(ecs-deploy): ...` |
| `.github/workflows/determine-image-digest.yml` | `determine-image-digest` | `chore(determine-image-digest): ...` |
| `.github/workflows/tofu-pre-commit.yml` | `tofu-pre-commit` | `chore(tofu-pre-commit): ...` |
| `.github/actions/wait-for-required-checks/**` | `wait-for-required-checks` | `chore(wait-for-required-checks): ...` |
| `.github/actions/turbo-repo-cache/**` | `turbo-repo-cache` | `chore(turbo-repo-cache): ...` |
| `.github/workflows/retag-images-ghcr.yml` | `retag-images-ghcr` | `chore(retag-images-ghcr): ...` |
| `.github/workflows/cleanup-images-ghcr.yml` | `cleanup-images-ghcr` | `chore(cleanup-images-ghcr): ...` |
| Other files | Default (`deps`) | `chore(deps): ...` |

## Adding a new component

1. Create `releases/<component>/.releaserc.js` — copy any existing config and update the `scope` constant to the new component name
2. Create `.github/workflows/release-<component>.yml` with `paths:` filter for the component's files
3. Add a `matchFileNames` rule to `renovate.json` to scope dependency updates
4. Add a line to the `case` statement in `.github/scripts/check-component-scope.sh` mapping the component's file path(s) to the new scope — same pattern as the `paths:` filter above
5. Update the Components table and Renovate table in this file, and the components table in `CLAUDE.md`
6. Seed an initial tag: `git tag <component>-v1.0.0 && git push origin --tags`

## Known trade-offs

### Version inflation

~~semantic-release analyses all commits since the last component tag, not just those touching the component's files.~~ Each `.releaserc.js` scopes both the commit analyzer and the release notes generator to the component's `scope`. Only commits with a matching scope can trigger a release or appear in release notes — unrelated commits are ignored.

### ecs-deploy runtime behaviour

`ecs-deploy.yml` checks out this repo from `ref: main` at runtime to access the `ecs-query` action. The version tag only controls the workflow YAML -- the `ecs-query` action code is always pulled from latest `main`.
