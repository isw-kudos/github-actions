---
description: Never draft-gate a workflow whose check is listed in the wait-for-required-checks aggregation gate.
paths:
  - ".github/workflows/**"
---

# Don't draft-gate checks in the required-checks gate

The `github-actions` rule says to gate jobs on non-draft PRs. **Exception:** never
draft-gate a workflow whose check is listed in a `wait-for-required-checks`
aggregation gate (`required-checks.yml`). The gate treats `skipped` as a pass and
is not re-triggered by `ready_for_review`, so a draft-gated required check lets the
PR merge without that check ever running. See
`.github/actions/wait-for-required-checks/README.md`.
