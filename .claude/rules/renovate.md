---
description: Renovate dependency-update policy at ISW — extend the central isw-kudos/renovate-config presets, add only repo-specific rules on top, and never re-declare or override org policy in a repo.
scope: universal
paths:
  - "renovate.json"
  - ".github/renovate.json"
  - ".renovaterc.json"
tags: [ci, renovate, dependencies, supply-chain]
source: [collab, boards, carbonhalo, terradeploy, renovate-config]
---

# Renovate dependency updates

Org Renovate policy has one home: the shared presets in
[`isw-kudos/renovate-config`](https://github.com/isw-kudos/renovate-config)
(`default.json`, `npm.json`, `gha.json`). Read the policy there. Do not copy
preset contents into a repo: a copy drifts, and every repo then needs a fix.

## Extend the presets

| Preset | Extend it when |
| --- | --- |
| `local>isw-kudos/renovate-config` | Always. It is the org baseline. |
| `local>isw-kudos/renovate-config:npm` | The repo has a `package.json`. |
| `local>isw-kudos/renovate-config:gha` | The repo has `.github/workflows/`. |

```jsonc
// ✅ the whole file for a typical repo
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": [
    "local>isw-kudos/renovate-config",
    "local>isw-kudos/renovate-config:npm",
    "local>isw-kudos/renovate-config:gha"
  ]
}
```

```jsonc
// ❌ re-declares org policy: this is the old copy-paste config, now stale
{
  "extends": ["config:recommended", ":prConcurrentLimit10"],
  "schedule": ["after 8am and before 6pm on monday to friday"],
  "postUpdateOptions": ["pnpmDedupe"],
  "customManagers": [{ "description": "Bump Node version in GitHub Actions workflows" }],
  "packageRules": [{ "matchManagers": ["github-actions"], "pinDigests": true }]
}
```

The presets already supply the schedule, PR limits, the workflow `node-version`
manager, and Docker/GitHub Actions digest pinning. `pnpmDedupe` comes from
`:npm` and has an effect only in pnpm repos. To change org policy, open a PR on
`renovate-config` so every repo gets the change.

## Add only repo-specific rules

Keep a key in the repo's `renovate.json` only when it applies to this repo alone.
Give each rule a `description` that says why.

- An extra group for a package family that the presets do not cover. Group
  **majors** only; non-majors already ride the weekly batch.
- An ignore or a version hold (`ignoreDeps`, `allowedVersions`).
- Submodules: ignore the submodule's tree from update scanning, but keep
  `"cloneSubmodules": true` so Renovate's builds and lockfile maintenance work.

## Do not override these preset controls

Repo `packageRules` apply after the preset rules, and a later rule wins per
option. So a repo rule can silently cancel a control. Never weaken these:

- **Zizmor lockstep group.** The zizmor CLI pin and `zizmor-action` move in one
  approval-gated PR. A split bump fails CI with "Unknown version"
  (isw-kudos/boards#341). Do not add a rule that matches a zizmor package.
- **Weekly grouping.** Updates land in one weekly window as a few grouped PRs.
  Do not set a repo `schedule`, raise `prConcurrentLimit`, or split non-majors
  out of their batch.
- **Draft majors behind the Dependency Dashboard.** Majors need dashboard
  approval and open as draft PRs. Do not automerge majors or remove the gate.
- **SHA `pinDigests` for GitHub Actions.** Renovate keeps every `uses:` on a
  maintained 40-char SHA, which zizmor's `unpinned-uses` audit requires. Do not
  disable `pinDigests` or the `github-actions` manager.

## Commit the config before the runner discovers the repo

On the self-hosted Mend Renovate CE runner, a repo that already has a
`renovate.json` skips the onboarding PR: Renovate acts on the committed config
at once. So merge a `renovate.json` that extends the presets **before** you add
the repo to the runner's autodiscover filter. Otherwise the first run opens PRs
under the stale policy.
