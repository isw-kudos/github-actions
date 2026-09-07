---
description: Renovate dependency-update policy at ISW — group related packages, automerge patch/minor/digest but review majors, enforce a minimum release age, schedule in business hours, limit PR volume, and bump tool versions embedded in workflows.
scope: universal
paths:
  - "renovate.json"
  - ".github/renovate.json"
  - ".renovaterc.json"
tags: [ci, renovate, dependencies, supply-chain]
source: [collab, boards, carbonhalo, terradeploy]
---

# Renovate dependency updates

Renovate keeps dependencies current with minimal manual toil while defending
against malicious or broken releases. Base config on `config:recommended`.

## Group related packages into one PR

Interdependent packages must move in lockstep or a split update breaks the
build. Add a `groupName` package rule per family, with a comment explaining
*why* they're grouped when the reason isn't obvious.

```jsonc
"packageRules": [
  { "groupName": "React", "matchPackageNames": ["react", "react-dom", "@types/react", "@types/react-dom"] },
  // vitest >= 4 requires vite >= 6, so bump them together
  { "groupName": "Vite + Vitest", "matchPackageNames": ["vite", "vitest", "@vitest/**"] },
  { "groupName": "Node LTS", "matchPackageNames": ["node", "@types/node"] }
]
```

## Automerge low-risk updates, require review for majors

Automerge `patch`/`minor`/`digest`. Hold `major` updates for manual review via
the Dependency Dashboard, labelled so they're easy to spot.

```jsonc
{ "description": "Automerge minor/patch/digest", "matchUpdateTypes": ["minor", "patch", "digest"], "automerge": true },
{ "description": "Majors need manual approval", "matchUpdateTypes": ["major"], "dependencyDashboardApproval": true, "addLabels": ["renovate/major"] }
```

Keep `platformAutomerge: false` unless branch protection reliably gates merges.

## Enforce a minimum release age

Wait several days before adopting a release so malicious or broken publishes get
caught and yanked first. Use 3–7 days.

```jsonc
"minimumReleaseAge": "7 days",
"minimumReleaseAgeBehaviour": "timestamp-optional"
```

## Schedule in business hours, maintain lockfiles weekly

Land updates when someone can react, in the team timezone (ISW: Tasmania).
Refresh the lockfile once a week off-hours.

```jsonc
"timezone": "Australia/Tasmania",
"schedule": ["after 8am and before 6pm on monday to friday"],
"lockFileMaintenance": { "enabled": true, "automerge": true, "schedule": ["before 6am on monday"] }
```

## Limit PR volume and dedupe

Cap open/hourly PRs so a burst of updates doesn't overwhelm CI or reviewers, and
dedupe the lockfile after each update.

```jsonc
"extends": ["config:recommended", ":prHourlyLimit2", ":prConcurrentLimit10", ":semanticCommits", ":dependencyDashboard"],
"postUpdateOptions": ["pnpmDedupe"]
```

Renovate emits `fix(deps)`/`chore(deps)` Conventional Commits (via
`:semanticCommits`) so history stays machine-parseable.

## Pin Docker/Actions digests

```jsonc
{ "matchCategories": ["docker"], "pinDigests": true },
{ "matchManagers": ["github-actions"], "pinDigests": true }
```

`config:recommended` does **not** pin github-actions digests — you must set
`pinDigests: true` on the `github-actions` manager explicitly (or extend
`helpers:pinGitHubActionDigests`). Without it a hand-pinned SHA is frozen
forever and rots, which is worse than a mutable tag: the pin is only a control
while Renovate maintains it. Deliberately-frozen internal workflows (that you
bump by SHA on purpose) can be excluded:

```jsonc
{ "description": "Our shared workflow is pinned manually", "matchPackageNames": ["your-org/devops"], "enabled": false }
```

## Custom regex managers for versions embedded in files

Renovate can bump tool/action versions that live inside YAML/scripts, not just
`package.json`. Add a `customManager` per pattern.

```jsonc
"customManagers": [
  {
    "customType": "regex",
    "description": "Bump Node version in GitHub Actions workflows",
    "managerFilePatterns": ["/^\\.github/workflows/.*\\.ya?ml$/"],
    "matchStrings": ["node-version:\\s*[\"']?(?<currentValue>\\d+)[\"']?"],
    "depNameTemplate": "node",
    "datasourceTemplate": "node-version",
    "versioningTemplate": "node"
  }
]
```

To track an internal SHA-pinned reusable action written with a `# <name>-vX.Y.Z`
comment, match the digest + version and resolve via `github-tags` so Renovate
keeps both the SHA and the comment current.

## Submodules

Ignore a submodule's tree from update scanning but keep `"cloneSubmodules": true`
so Renovate's own builds/lockfile maintenance still work.
