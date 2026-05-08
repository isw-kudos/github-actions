---
name: per-component-versioning
description: Use when working with releases, version bumps, semantic-release, component tags, Renovate scopes, or adding a new reusable workflow/action component to ISW-Cloud42/github-actions. Triggers include questions like "how is X released", "what version bump will this commit produce", "how do I add a new component", "why didn't a release fire", or any change to release-*.yml, releases/**, or renovate.json packageRules.
---

# Per-Component Versioning

Canonical reference: [`docs/per-component-versioning.md`](../../../docs/per-component-versioning.md). Read it for the full picture; this skill summarises the operational rules you need when making changes.

## Components and tag prefixes

| Component | Tag prefix | Watched paths |
|---|---|---|
| `docker-build` | `docker-build-v` | `.github/workflows/docker-build.yml` |
| `ecs-deploy` | `ecs-deploy-v` | `.github/workflows/ecs-deploy.yml`, `.github/actions/ecs-query/**` |
| `determine-image-digest` | `determine-image-digest-v` | `.github/workflows/determine-image-digest.yml` |
| `tofu-pre-commit` | `tofu-pre-commit-v` | `.github/workflows/tofu-pre-commit.yml` |
| `wait-for-required-checks` | `wait-for-required-checks-v` | `.github/actions/wait-for-required-checks/**` |
| `claude-code-review` | `claude-code-review-v` | `.github/workflows/claude-code-review.yml` |

`ecs-query` (under `.github/actions/ecs-query/**`) is part of the **`ecs-deploy`** component — changes there bump `ecs-deploy-v`, not a separate tag.

## Release mechanics

- Each component has `.github/workflows/release-<component>.yml` triggered by push to `main` with a `paths:` filter scoped to the component's files.
- Release workflow runs `npx semantic-release` from `releases/<component>/` (each has its own `.releaserc.yaml` differing only in `tagFormat`).
- Plain `semantic-release` is used (not `semantic-release-monorepo`) because reusable workflows share `.github/workflows/`, which prevents directory-based commit filtering.
- `@semantic-release/github` creates the git tag and GitHub Release.
- Tags are pushed to all mirror orgs by `sync-mirrors.yml` so consumers in any mirror org see the same versions.

## Conventional Commit bump rules

| Commit | Bump |
|---|---|
| `feat!:` / `BREAKING CHANGE:` | Major |
| `feat:` | Minor |
| `fix:` / `perf:` / `chore(deps):` | Patch |
| Anything else | Patch (catch-all) |

Use the matching component scope: `feat(ecs-deploy): ...`, `fix(docker-build): ...`. Unscoped commits still cut a patch via the catch-all but make release notes ambiguous.

### Version inflation caveat

semantic-release analyses **all** commits since the last component tag, not just those touching the component's files. An unrelated `feat:` commit can bump a component to a minor when only patches landed. Cosmetic — consumers always get the correct code.

## Renovate ↔ release wiring

`renovate.json` `packageRules` map paths to component scopes so bot updates trigger the correct release:

| Renovate matches | Commit produced | Component released |
|---|---|---|
| `.github/workflows/docker-build.yml` | `fix(docker-build): ...` | docker-build (patch) |
| `.github/workflows/ecs-deploy.yml` | `fix(ecs-deploy): ...` | ecs-deploy (patch) |
| `.github/actions/ecs-query/**` | `fix(ecs-deploy): ...` | ecs-deploy (patch) |
| `.github/workflows/determine-image-digest.yml` | `fix(determine-image-digest): ...` | determine-image-digest (patch) |
| `.github/workflows/tofu-pre-commit.yml` | `fix(tofu-pre-commit): ...` | tofu-pre-commit (patch) |
| `.github/actions/wait-for-required-checks/**` | `fix(wait-for-required-checks): ...` | wait-for-required-checks (patch) |
| `.github/workflows/claude-code-review.yml` | `fix(claude-code-review): ...` | claude-code-review (patch) |
| Anything else | `chore(deps): ... (github-actions)` | None (no `paths:` match) |

Each scope rule sets `semanticCommitType: "fix"`, `semanticCommitScope: "<component>"`, `commitMessageSuffix: ""` (the empty suffix overrides the default `(github-actions)` so subjects stay clean).

Other Renovate behaviours that affect cadence:

- `minimumReleaseAge: "3 days"` (top-level), `"14 days"` for `custom.regex` managers.
- `pinDigests: true` for the github-actions manager — actions pinned by SHA with a version comment Renovate updates.
- `automerge: true` for minor/patch outside `github-actions` and `custom.regex` managers — those merge themselves and trigger releases without human review. **Keep `paths:` filters tight on release workflows.**

## Adding a new component

1. Create `releases/<component>/.releaserc.yaml`. Copy an existing one and only change `tagFormat`.
2. Create `.github/workflows/release-<component>.yml`. Copy an existing one and only change the `paths:` filter and the `working-directory` for `npx semantic-release`.
3. Add a `packageRules` entry to `renovate.json` matching the component's files with `semanticCommitType: "fix"`, `semanticCommitScope: "<component>"`, `commitMessageSuffix: ""`. **Skipping this means Renovate updates fall through to `chore(deps)` and miss the release filter.**
4. Seed an initial tag: `git tag <component>-v1.0.0 && git push origin --tags`.
5. Update `docs/per-component-versioning.md` components table and `CLAUDE.md` components table.

## Runtime caveat: ecs-deploy

`ecs-deploy.yml` checks out this repo at `ref: main` at runtime to access the `ecs-query` action. The `ecs-deploy-vX.Y.Z` tag pins the workflow YAML, but the `ecs-query` Python code is always pulled from latest `main`. Keep this in mind when reasoning about what a pinned `ecs-deploy` version actually freezes.

## Diagnosing a missing release

If a change merged but no release fired:
1. Check the commit's `paths` actually overlap the release workflow's `paths:` filter.
2. Check the commit message has a Conventional Commit prefix — purely off-spec messages may be skipped by the analyzer.
3. Check the release workflow run on the commit — semantic-release logs say "no relevant changes" when nothing in the analysed range warrants a bump.
4. For Renovate PRs: confirm the right `packageRules` scope rule matched (look at the PR commit subject — wrong scope or `chore(deps)` means the rule didn't match).
