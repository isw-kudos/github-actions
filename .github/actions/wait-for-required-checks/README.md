# wait-for-required-checks

Node action (`using: node24`, `index.cjs`, zero npm dependencies) that polls
the GitHub Checks API for a list of named check-run contexts on a pull
request's head SHA. Acts as a single-context aggregator for branch protection
/ repository rulesets, so that one required status (e.g. `Required Checks`)
can stand in for many real checks -- including ones that may not run on every
PR because their source workflow is gated by `paths:`.

## Why

A repository ruleset that requires a context like `Lint, Type Check & Test`
will block a PR forever if the source workflow's `on.pull_request.paths:`
filter excludes that PR's diff -- the workflow never triggers, the context is
never registered, and the ruleset waits indefinitely.

This action sidesteps that by always running on every PR (no `paths:` filter on
the caller workflow) and waiting for the named checks to either resolve or
fail to appear within a grace window.

## Usage

```yaml
# .github/workflows/required.yml in a consuming repo
name: Required Checks

on:
  pull_request_target:
    branches: [main]

concurrency:
  group: required-${{ github.event.pull_request.number }}
  cancel-in-progress: true

permissions:
  checks: read
  pull-requests: read
  contents: read

jobs:
  required-checks:
    name: Required Checks    # <-- this string is the registered context
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: ISW-AISP/github-actions/.github/actions/wait-for-required-checks@wait-for-required-checks-v1.0.0
        with:
          required-checks: |
            Lint, Type Check & Test
            Docker Build / Build & Push
```

Then point the branch ruleset's `required_status_checks` at the single context
`Required Checks` (or whatever the gate job's `name:` resolves to).

### Why `pull_request_target`

Use `pull_request_target` rather than `pull_request` so the gate workflow is
loaded from the base branch (e.g. `main`) and a PR cannot disable, rename, or
otherwise tamper with the gate by editing the workflow file in the PR diff.

Because this action only reads the Checks API for the head SHA -- no checkout,
no execution of PR code -- it is safe to run under `pull_request_target`.
**Do not** add `actions/checkout` of `${{ github.event.pull_request.head.sha }}`
or any other step that runs PR-supplied code in the same job.

Note: under `pull_request_target`, `github.ref` is the base branch ref, so use
`github.event.pull_request.number` for the `concurrency.group` -- otherwise
all PRs share a group and cancel each other.

**Do not** add a `paths:` filter to the caller workflow. The whole point is
that the gate runs on every PR.

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `required-checks` | yes | -- | Newline-separated list of check-run names. Match the exact strings shown in the ruleset's `required_status_checks` -- for reusable workflows that's the composite `<caller-job> / <called-job>` form. |
| `grace-seconds` | no | `90` | Seconds to wait for a check to first appear on the head SHA before treating it as not-applicable. Bump this if your slowest workflow can take longer than 90s to be queued by GitHub. |
| `poll-seconds` | no | `15` | Seconds between polls of the Checks API. |
| `max-wait-seconds` | no | `2400` | Hard ceiling on total wait time. |
| `head-sha` | no | `${{ github.event.pull_request.head.sha }}` | Commit SHA to read check-runs for. |
| `github-token` | no | `${{ github.token }}` | Token used for Checks API calls. Needs `checks: read` (already true for the default `GITHUB_TOKEN`). |

## Resolution rules

For each required check, the action picks the most recent matching check-run
(sorted by `started_at`) and applies:

| Latest check state | Action |
|---|---|
| Absent, elapsed < `grace-seconds` | keep waiting |
| Absent, elapsed >= `grace-seconds` | treat as not-applicable (success) -- source workflow's `paths:` excluded this PR |
| `queued` / `in_progress` / `pending` / `waiting` | keep waiting |
| `completed` + `success` / `skipped` / `neutral` | success |
| `completed` + `failure` / `cancelled` / `timed_out` / `action_required` | gate fails immediately, naming the failed check |
| Total elapsed > `max-wait-seconds` | gate fails with a timeout error |

## Testing

`index.cjs` exports its pure helpers (`parseNames`, `latestFor`,
`classifyLatest`, `nextLink`) and only runs the poll loop when invoked
directly, so the resolution rules can be unit-tested with plain `node` -- no
runner required.
