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
2. **Derive filters** (opt-in, `derive-filters: "true"`) — builds each
   image's filter from its Dockerfile and the pnpm workspace graph, so a
   change to a package rebuilds only the images that bundle it. See
   [Deriving filters](#deriving-filters-from-the-workspace-graph).
3. **paths-filter** — pinned by SHA, with `base:` defaulting to the pushed
   branch on push events (multi-branch push repos would otherwise diff
   against the repo default branch) and empty elsewhere (avoids the
   ignored-input warning on PR runs).
4. **Matrix assembly** — a jq step builds the include-array from the filter
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
- With `derive-filters`: a pnpm workspace whose root `package.json` pins
  pnpm in `packageManager`. The action runs `actions/setup-node` (Node 24)
  and `corepack enable` itself, so both stay on `PATH` for the caller's
  later steps in the job.

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

## Deriving filters from the workspace graph

A static `packages/**` shared filter rebuilds every image when any package
changes. With `derive-filters: "true"` the action writes the filters itself
from what each Dockerfile can put into its image:

- **The Dockerfile itself**, and the `<Dockerfile>.dockerignore` BuildKit
  reads beside it.
- **Prune closures.** Every target of every `turbo prune <targets>` in a
  `RUN` instruction (turbo v1 `--scope` included), with its workspace
  dependency closure (dev dependencies included, as prune does), from
  `pnpm ls --fail-if-no-match --parseable --depth -1 --filter=<target>...`.
  Each project directory becomes `<dir>/**`.
- **Build-context sources.** Every source of every `COPY` and `ADD` without
  `--from`, in shell or JSON form, with or without a leading `./` or `/`
  and with shell quotes removed, and every `RUN --mount=type=bind` without
  `from=`. A directory becomes `<dir>/**` and a file stays as written; a
  glob or a missing path gets both forms. `COPY . .` (the whole context),
  heredocs and remote `ADD` sources are skipped. These catch files no
  closure covers, such as another app's Prisma schema.
- **`shared-paths`** become a `shared` filter that every derived filter
  includes through a YAML anchor. A source that is already a shared path is
  not repeated under the image.
- **`aggregate-filters`** add filters such as a boot-smoke surface: the union
  of every image filter except `exclude`, plus `paths`.

A new prune target, COPY or workspace dependency widens the filter with no
workflow edit. The derived YAML is printed in a collapsed log group.

The run **fails loudly** (never a filter that silently never matches) when:

- a Dockerfile has no `turbo prune` line;
- a build-context source uses a variable (`COPY ${APP}/prisma ...`) or
  quoting the parser cannot resolve: spell the path out;
- a Dockerfile sets an `escape` directive other than `\`;
- a prune target is not a package name, or pnpm finds no workspace project
  for it (pnpm runs once per target, because `--fail-if-no-match` only fails
  when every filter misses);
- `pnpm ls` prints a line that is not a project directory inside the repo;
- `images`, `shared-paths` or `aggregate-filters` is malformed: an unknown
  `exclude` key, an unknown aggregate field, or a filter name used twice.

The derive steps (setup-node, corepack, derive) run only when paths-filter
runs: not on `workflow_dispatch`, and not on a push with no reachable diff
base. So a registry or corepack outage cannot block a manual rebuild.

Limits:

- **A stage that copied the whole context** (`COPY . .` before
  `turbo prune`) is assumed to be read only through prune's `out/` and
  shared root files. A later `COPY --from=<that stage> /app/apps/other/...`
  reads a path no filter covers; add it to `shared-paths`, or COPY it from
  the context instead.
- **Do not derive on `pull_request_target` with a head checkout.** Derive
  mode runs the pnpm that the checked-out `packageManager` names, under
  the workflow's token, so it runs code the PR controls.

### What goes in `shared-paths`

Paths that every image build reads beyond its own closure:

- `pnpm-lock.yaml` and the root files `turbo prune --docker` copies
  (`package.json`, `pnpm-workspace.yaml`, `.npmrc`, `turbo.json`), plus
  `.dockerignore`, which shapes the context prune runs over.
- The workflow file itself.
- A submodule's **bare gitlink path** (e.g. `huddo-services`): a pointer
  bump changes exactly that path, so a glob into the submodule never
  matches.
- Workspace edges pnpm cannot see. A workspace member that lives in an
  unchecked-out submodule has no `package.json` on disk, so its own
  dependencies are invisible. Add those by hand (e.g.
  `packages/typescript-config/**` when the submodule's members depend on
  it).

### Usage

```yaml
      - name: Detect changed images
        id: changes
        uses: isw-kudos/github-actions/.github/actions/detect-image-changes@<sha> # detect-image-changes-vX.Y.Z
        with:
          dispatch-images: ${{ inputs.images }}
          derive-filters: "true"
          shared-paths: |
            pnpm-lock.yaml
            package.json
            pnpm-workspace.yaml
            .npmrc
            turbo.json
            .dockerignore
            .github/workflows/images.yml
            # bare gitlink: a submodule pointer bump changes exactly this path
            huddo-services
          aggregate-filters: |
            {"smoke": {"exclude": ["webfront"], "paths": ["docker-compose.smoke.yaml"]}}
          images: |
            {
              "api": {"dockerfile_path": "apps/api/Dockerfile", "image": "api"},
              "webfront": {"dockerfile_path": "apps/webfront/Dockerfile", "image": "webfront"}
            }
```

The caller needs no Node.js, corepack or derive steps of its own.

## Inputs

| Input | Required | Default | Purpose |
|---|---|---|---|
| `filters` | unless `derive-filters` | `""` | paths-filter YAML; one filter per image key, plus any extra filters (they surface in `changed_keys`); not allowed with `derive-filters` |
| `derive-filters` | no | `"false"` | `"true"` derives the filters from each Dockerfile and the pnpm workspace graph |
| `shared-paths` | no | `""` | with `derive-filters`: newline list for the `shared` filter every image includes; `#` lines are comments |
| `aggregate-filters` | no | `""` | with `derive-filters`: JSON `{name: {exclude?: [image keys], paths?: [paths]}}`; each is the union of the included image filters plus `paths` |
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
