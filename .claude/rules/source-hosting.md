---
description: Where ISW source code lives — every repo, fork, and shared asset is hosted in an ISW GitHub org (isw-kudos, ISW-AISP, ISW-Cloud42, ISW-AppDevelopment), private by default, and shared ISW repos are reused by reference instead of copied.
scope: meta
tags: [git, github, hosting, repos, governance]
source: [agent-standards]
---

# Host source code in ISW GitHub orgs

ISW code lives in the ISW GitHub orgs:

- [`isw-kudos`](https://github.com/isw-kudos)
- [`ISW-AISP`](https://github.com/ISW-AISP)
- [`ISW-Cloud42`](https://github.com/ISW-Cloud42)
- [`ISW-AppDevelopment`](https://github.com/ISW-AppDevelopment)

Code there gets the org's access control, branch protection, CI, Renovate, and
review. Code anywhere else gets none of that. It also leaves with the person who
owns the account.

## The rule

- **New repos go in an ISW org.** Don't use a personal GitHub account, a personal
  GitLab/Bitbucket, or a gist. Choose the org that owns the product. If that isn't
  clear, ask. Don't guess.
- **Private by default.** Make a repo public only when the user explicitly says so.
- **Forks go in an ISW org.** A patched third-party dependency is forked into an ISW
  org, not into someone's personal account. The build then doesn't depend on one
  person's access.
- **Dependencies point at ISW-hosted repos.** Git dependencies, submodules, Nix
  flake inputs, Terraform module sources, and CI `uses:` that refer to ISW code
  resolve to an ISW org, never to a personal copy.
- **Reuse shared ISW repos by reference. Don't copy them.** Org policy has one home.
  Extend it there and don't vendor a copy that drifts. For example:
  `isw-kudos/agent-standards` (via the plugin or importer), and
  `isw-kudos/renovate-config` (via `extends`, see the renovate rule).

```bash
# ✅
gh repo create isw-kudos/report-service --private
git submodule add git@github.com:isw-kudos/shared-schemas.git vendor/shared-schemas

# ❌ personal account, public by default, a copy of a shared repo
gh repo create report-service --public
cp -r ~/code/renovate-config/default.json ./renovate.json
```

## What the agent does

- **Creating a repo** (`gh repo create`, a new remote): default the owner to an ISW
  org and `--private`. Confirm the org with the user.
- **Spotting a remote outside the ISW orgs** on work code: say so **once** and
  suggest moving or forking it into an ISW org. Don't move, re-point, or push
  anything yourself. Changing where code lives is the user's decision.
- **About to copy a shared ISW repo's content**: link to it or extend it instead.
  If extending is impossible, say why in the commit message.

Open-source contributions upstream and the user's own personal projects are out of
scope. This rule is about ISW work.
