---
name: per-component-versioning
description: Use when working with releases, version bumps, semantic-release, component tags, Renovate scopes, or adding a new reusable workflow/action component to isw-kudos/github-actions. Triggers include questions like "how is X released", "what version bump will this commit produce", "how do I add a new component", "why didn't a release fire", or any change to release-*.yml, releases/**, or renovate.json packageRules.
---

# Per-Component Versioning

Canonical reference: [`docs/per-component-versioning.md`](../../../docs/per-component-versioning.md). Read it for the full picture; this skill summarises the operational rules you need when making changes.

## Components and tag prefixes

Full registry: [`docs/per-component-versioning.md`](../../../docs/per-component-versioning.md) (Components table). Two illustrative shapes:

| Component | Tag prefix | Watched paths | Notes |
|---|---|---|---|
| `ecs-deploy` | `ecs-deploy-v` | `.github/workflows/ecs-deploy.yml`, `.github/actions/ecs-query/**` | Multi-path component — `ecs-query` action is part of `ecs-deploy`, not its own tag |
| `wait-for-required-checks` | `wait-for-required-checks-v` | `.github/actions/wait-for-required-checks/**` | Simple single-path action |

Tag prefix convention is `<component>-v`. Watched paths must match the release workflow's `paths:` filter exactly.

## Release mechanics

- Each component has `.github/workflows/release-<component>.yml` triggered by push to `main` with a `paths:` filter scoped to the component's files.
- Release workflow runs `npx semantic-release` from `releases/<component>/` (each has its own `.releaserc.js` with a `scope` constant that gates which commits trigger a release and appear in release notes).
- Plain `semantic-release` is used (not `semantic-release-monorepo`) because reusable workflows share `.github/workflows/`, which prevents directory-based commit filtering.
- Both commit-analyzer and release-notes-generator use `preset: 'conventionalcommits'` (the package is supplied via `npx --package conventional-changelog-conventionalcommits@<pin>` in each release workflow). The default `angular` preset cannot parse `type(scope)!:` headers, and squash merges drop `BREAKING CHANGE:` footers, so without this preset a major bump silently produces no release. Do not remove either half.
- **The PR title is the commit.** Squash merge uses the PR title as subject with a blank body. Make the PR title conventional and scoped, and use `!` (not a footer) for breaking changes.
- `@semantic-release/github` creates the git tag and GitHub Release.

## Conventional Commit bump rules

| Commit | Bump |
|---|---|
| `feat(<component>)!:` / `BREAKING CHANGE:` with component scope | Major |
| `feat(<component>):` | Minor |
| `fix(<component>):` / `perf(<component>):` | Patch |
| `chore(<component>):` | Patch |
| Any other scope | No release |

Use the matching component scope: `feat(ecs-deploy): ...`, `fix(docker-build): ...`, `chore(turbo-repo-cache): ...`. Renovate emits `chore(<component>): ...` for dependency bumps; humans use `fix`/`feat` for actual bug fixes and features. Commits with a non-matching scope are ignored — they do not trigger a release or appear in release notes.

## Renovate ↔ release wiring

`renovate.json` `packageRules` map paths to component scopes so bot updates trigger the correct release. Full mapping in [`docs/per-component-versioning.md`](../../../docs/per-component-versioning.md). Pattern:

| Renovate matches | Commit produced | Component released |
|---|---|---|
| `.github/actions/<component>/**` or `.github/workflows/<component>.yml` | `chore(<component>): ...` | `<component>` (patch) |
| Anything else | `chore(deps): ... (github-actions)` | None (no `paths:` match) |

Each scope rule sets `semanticCommitType: "chore"`, `semanticCommitScope: "<component>"`, `commitMessageSuffix: ""` (the empty suffix overrides the default `(github-actions)` so subjects stay clean). `chore` is used because Renovate is doing maintenance, not bug fixes. Manually use `feat(<component>): ...` for new functionality to get a minor bump, or `fix(<component>): ...` for human bug fixes.

Other Renovate behaviours that affect cadence:

- `minimumReleaseAge: "3 days"` (top-level), `"14 days"` for `custom.regex` managers.
- `pinDigests: true` for the github-actions manager — actions pinned by SHA with a version comment Renovate updates.
- `automerge: true` for minor/patch outside `github-actions` and `custom.regex` managers — those merge themselves and trigger releases without human review. **Keep `paths:` filters tight on release workflows.**

## Adding a new component

1. Create `releases/<component>/.releaserc.js`. Copy an existing one and only change the `scope` constant.
2. Create `.github/workflows/release-<component>.yml`. Copy an existing one and only change the `paths:` filter and the `working-directory` for `npx semantic-release`.
3. Add a `packageRules` entry to `renovate.json` matching the component's files with `semanticCommitType: "chore"`, `semanticCommitScope: "<component>"`, `commitMessageSuffix: ""`. **Skipping this means Renovate updates fall through to default `chore(deps)` without the component scope, leaving release notes ambiguous.**
4. Add a `case` entry to `.github/scripts/check-component-scope.sh` mapping the component's watched path(s) to the new scope — mirrors the `paths:` filter in the release workflow. **Skipping this means the commit-msg hook won't catch missing scopes for the new component.**
5. Seed an initial tag: `git tag <component>-v1.0.0 && git push origin --tags`.
6. Update `docs/per-component-versioning.md` (Components + Renovate tables) and `CLAUDE.md` components table. This skill's tables are illustrative — no edit needed.

## Runtime caveat: ecs-deploy

`ecs-deploy.yml` checks out this repo at `ref: main` at runtime to access the `ecs-query` action. The `ecs-deploy-vX.Y.Z` tag pins the workflow YAML, but the `ecs-query` Python code is always pulled from latest `main`. Keep this in mind when reasoning about what a pinned `ecs-deploy` version actually freezes.

## Diagnosing a missing release

If a change merged but no release fired:
1. Check the commit's `paths` actually overlap the release workflow's `paths:` filter.
2. Check the commit message uses the correct component scope (e.g. `fix(docker-build): ...`) — commits without a matching scope are ignored by the analyzer.
3. Check the release workflow run on the commit — semantic-release logs say "no relevant changes" when nothing in the analysed range warrants a bump.
4. For Renovate PRs: confirm the right `packageRules` scope rule matched (look at the PR commit subject — should be `chore(<component>): ...`; bare `chore(deps)` means the scope rule didn't match).
5. Check the semantic-release log for "The local branch main is behind the remote one" — a push landed on `main` while the run was in flight. Release workflows check out `ref: main` (branch tip, not the push SHA) to make this rare; if it still happens, re-run via `workflow_dispatch` to release the missed commit.
6. If the log shows every commit rejected ("The commit should not trigger a release") including correctly scoped ones, check `releaseRules` ordering in `.releaserc.js` — the catch-all `{ release: false }` must be FIRST; commit-analyzer lets a later-matching `release: false` override an earlier match, so placed last it suppresses all releases.
