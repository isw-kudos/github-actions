# detect-image-changes

Change detection for a consolidated image-build workflow. One `changes` job
per repo used to inline the same three steps; this composite owns them so
paths-filter-class fixes land once:

1. **Fetch push-diff base** — paths-filter diffs push events against the
   push's before-commit, which a depth-1 checkout with
   `persist-credentials: false` can neither see nor fetch. The action
   pre-fetches it with a one-process `GIT_CONFIG_*` extraheader credential
   (the token never lands in a command line or on disk), guarded by an
   `if`-form `git cat-file -e "${BEFORE_SHA}^{commit}"` short-circuit (an
   `&&`-list miss would abort under `bash -e`) and an all-zero-SHA skip
   (branch-creation pushes have no before). When the base is unreachable
   (all-zero, or force-pushed away), the matrix falls back to **building
   everything**: an over-build is recoverable, a red run that built nothing
   is not.
2. **paths-filter** — pinned by SHA, with `base:` defaulting to the pushed
   branch on push events (multi-branch push repos would otherwise diff
   against the repo default branch) and empty elsewhere (avoids the
   ignored-input warning on PR runs).
3. **Matrix assembly** — a jq step builds the include-array from the filter
   results, or from a `workflow_dispatch` comma-separated key list (empty =
   all). Any unknown dispatch key — even alongside valid ones — **fails the
   run loudly**: silently selecting nothing would give the operator a green
   run that rebuilt nothing.

## Requirements

- **The caller owns the checkout.** Run `actions/checkout` (depth 1,
  `persist-credentials: false` is fine) before this action; a composite must
  not assume it owns the workspace.
- The job needs `contents: read` (checkout + push-diff base fetch) and
  `pull-requests: read` (paths-filter lists a PR's changed files).
- `jq` and `git` on the runner (present on GitHub-hosted runners).

## Usage

```yaml
jobs:
  changes:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
    outputs:
      matrix: ${{ steps.changes.outputs.matrix }}
      any_images: ${{ steps.changes.outputs.any_images }}
    steps:
      - uses: actions/checkout@<sha> # vX.Y.Z
        with:
          persist-credentials: false

      - name: Detect changed images
        id: changes
        uses: isw-kudos/github-actions/.github/actions/detect-image-changes@<sha> # detect-image-changes-vX.Y.Z
        with:
          dispatch-images: ${{ inputs.images }}
          filters: |
            shared: &shared
              - "packages/**"
              - "pnpm-lock.yaml"
              - ".github/workflows/images.yml"
            api:
              - *shared
              - "apps/api/**"
            web:
              - *shared
              - "apps/web/**"
          images: |
            {
              "api": {"dockerfile_path": "apps/api/Dockerfile", "image": "api"},
              "web": {"dockerfile_path": "apps/web/Dockerfile", "image": "web",
                      "build_args": "BUILD_ID_ARG=${{ github.run_number }}"}
            }

  build:
    needs: changes
    if: needs.changes.outputs.any_images == 'true'
    strategy:
      fail-fast: false
      matrix:
        include: ${{ fromJSON(needs.changes.outputs.matrix) }}
    ...
```

## Inputs

| Input | Required | Default | Purpose |
|---|---|---|---|
| `filters` | yes | — | paths-filter YAML; one filter per image key, plus any extra filters (they surface in `changed_keys`) |
| `images` | yes | — | JSON object: image key → `{dockerfile_path, image, build_args?}`; key order is preserved in the matrix; missing `build_args` becomes `""` |
| `dispatch-images` | no | `""` | comma-separated keys on `workflow_dispatch`; empty = all; unknown key fails loudly |
| `token` | no | `github.token` | base fetch + PR file listing |
| `base` | no | pushed branch on push, else empty | diff base override for push events |

## Outputs

| Output | Value |
|---|---|
| `matrix` | include-array JSON: `[{dockerfile_path, image, build_args}, ...]` in `images` key order |
| `any_images` | `"true"` when the matrix is non-empty |
| `changed_keys` | JSON array of every matched filter name (image keys and extra filters alike); `[]` on `workflow_dispatch` or when a push has no reachable diff base |

`changed_keys` exists so callers can derive event-dependent values the matrix
does not carry — e.g. a boot-smoke job picking `pr-<n>` vs `main` image tags
per key, or a `run_smoke` flag from an extra `smoke` filter:

```yaml
- name: Compute smoke tags
  id: smoke
  env:
    EVENT_NAME: ${{ github.event_name }}
    PR_NUMBER: ${{ github.event.pull_request.number }}
    CHANGED_KEYS: ${{ steps.changes.outputs.changed_keys }}
  run: |
    set -euo pipefail
    changed() { jq -e --arg k "$1" 'index($k) != null' <<<"$CHANGED_KEYS" > /dev/null; }
    if [ "$EVENT_NAME" = "pull_request" ] && changed smoke; then
      echo "run_smoke=true" >> "$GITHUB_OUTPUT"
    else
      echo "run_smoke=false" >> "$GITHUB_OUTPUT"
    fi
    smoke_tag() {
      if [ "$EVENT_NAME" = "pull_request" ] && changed "$2"; then
        echo "$1=pr-${PR_NUMBER}" >> "$GITHUB_OUTPUT"
      else
        echo "$1=main" >> "$GITHUB_OUTPUT"
      fi
    }
    smoke_tag api_tag api
```

Note on push events with an unreachable diff base: `changed_keys` is `[]`
while `matrix` contains every image. Callers that branch on `changed_keys`
for anything push-relevant must handle that asymmetry (the smoke pattern
above is unaffected — it only branches on `pull_request` events, where the
filter always ran).

## What deliberately stays in the caller

GitHub evaluates workflow-level `concurrency:` and job-level `if:` before any
action runs, so these **cannot be centralised**. They are repeated in every
consumer; this is the reference copy for drift checks.

The canonical draft/one-shot-label gate on the `changes` job (drafts skip the
batch; applying a `build` label to a draft runs it once):

```yaml
if: >-
  github.event_name != 'pull_request' ||
  (github.event.action == 'labeled' && github.event.label.name == 'build' && github.event.pull_request.draft == true) ||
  (github.event.action != 'labeled' && github.event.pull_request.draft == false)
```

The canonical concurrency block (its group key mirrors the gate: a run whose
jobs will all skip gets a throwaway per-run group, so it can never cancel an
in-flight real run; pushes and dispatches also get per-run groups so every
commit completes):

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ (github.event_name == 'pull_request' && ((github.event.action == 'labeled' && github.event.label.name == 'build' && github.event.pull_request.draft == true) || (github.event.action != 'labeled' && github.event.pull_request.draft == false))) && github.ref || github.run_id }}
  cancel-in-progress: true
```

Also caller-owned, because they are repo-specific: the filter definitions,
the image map, smoke-tag derivation, and the build job's reusable-workflow
call.
