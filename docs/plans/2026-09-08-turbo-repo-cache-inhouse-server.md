# turbo-repo-cache: replace the unmaintained upstream action with an in-house server runner

## Context

`.github/actions/turbo-repo-cache` wraps `trappar/turborepo-remote-cache-gh-action`
to start a local Turborepo remote-cache server backed by GCS. The pinned upstream
commit is the `v1` tag from Feb 2023 (`using: node16`); the maintainer rewrote it
for node 20 on an unreleased `v2` branch in Feb 2024 and has not responded to the
release request open since Dec 2024. Node 20 is itself being retired by GitHub in
favour of node 24, so the dependency is a dead end.

The upstream action is ~150 lines of glue around the actively maintained
`turborepo-remote-cache` npm package (ducktors; 2.12.3 released 2026-09-02,
node >= 20, CLI binary, GCS provider falls back to Application Default
Credentials). Goal: own that glue here, with no compiled bundle to maintain.

Out of scope: changing the GCP auth step, supporting Windows runners, adding a
`turbo` end-to-end test (a curl round-trip against the artifact API is enough).

## Architecture

```
consumer job
  └─ uses: isw-kudos/github-actions/.github/actions/turbo-repo-cache@<tag>   (composite)
       ├─ google-github-actions/auth        -> GOOGLE_APPLICATION_CREDENTIALS (unchanged)
       └─ uses: $/.github/actions/turbo-repo-cache/server                     (node24, zero deps)
            main: start.cjs
              1. validate inputs (allowlists)
              2. npm ci  server/package.json (turborepo-remote-cache, exact pin)
              3. pick free port, random token
              4. spawn detached:  node node_modules/turborepo-remote-cache/dist/cli.js
                   env HOST=127.0.0.1 PORT TURBO_TOKEN STORAGE_PROVIDER STORAGE_PATH
                   stdout/stderr -> $RUNNER_TEMP/turbo-repo-cache/{out,err}.log
              5. poll GET /v8/artifacts/status until 200 (or child exits / 15 s)
              6. GITHUB_ENV  += TURBO_API TURBO_TOKEN TURBO_TEAM ; GITHUB_STATE += pid, log_dir
            post: stop.cjs
              SIGTERM pid if alive (warn if it died early), print server logs in a group

  subsequent `turbo` steps ──HTTP──▶ 127.0.0.1:<port> ──GCS SDK (ADC)──▶ bucket
```

`$/` is the self-repository reference: inside a composite it resolves to this repo
at the exact commit the composite is running from, so the nested action is always
version-locked to the public one (runner >= 2.336.0, same as `ecs-deploy`).

## Key interfaces

Public composite `action.yml` inputs (unchanged plus one optional addition):

```yaml
workload-identity-provider: required
service-account:            required
storage-path:               required            # bucket name
storage-provider:           default google-cloud-storage
team-id:                    default ci          # NEW, optional: TURBO_TEAM / cache namespace
```

Nested `server/action.yml`:

```yaml
inputs:  storage-provider (required) | storage-path (required) | team-id (default ci)
runs:    using: node24, main: start.cjs, post: stop.cjs
```

Exported job env (same contract as upstream): `TURBO_API=http://127.0.0.1:<port>`,
`TURBO_TOKEN=<48 hex>` (masked), `TURBO_TEAM=<team-id>`.

Allowlists at the boundary: `storage-provider` in `{s3, google-cloud-storage,
azure-blob-storage, local}`; `storage-path` `^[A-Za-z0-9._/-]+$`; `team-id`
`^[A-Za-z0-9_-]+$` (it is written to `GITHUB_ENV`).

## Implementation Order

- [x] 1. `server/package.json` + `package-lock.json` pinning `turborepo-remote-cache` exactly; add `node_modules/` to `.gitignore`
- [x] 2. `server/start.cjs`, `server/stop.cjs`, `server/action.yml` (zero-dependency node24 action)
- [x] 3. Rewrite the composite `action.yml` to call `$/.github/actions/turbo-repo-cache/server`; add `team-id`
- [x] 4. `README.md` for the action: inputs, exported env, prerequisites (npm on PATH, runner >= 2.336.0, Linux/macOS), versioning note
- [x] 5. Smoke-test workflow `.github/workflows/turbo-repo-cache-test.yml`: run the nested action with `storage-provider: local`, assert the env vars, PUT + GET an artifact via curl; list it in `required-checks.yml`
  _deviation: no `actions/checkout` step; zizmor's `self-repository` audit asked for `$/` over `./`, which loads the action without a checkout. The unauthenticated-GET assertion is "not 200" rather than 401 because the server answers 400 (missing Authorization header)._
- [x] 6. Local verification (below), zizmor + pre-commit clean
  _note: zizmor must be run with `server/node_modules` absent (or excluded); it otherwise audits third-party workflows shipped inside npm packages. CI is unaffected since node_modules is not committed._
- [x] 7. Progress log entry; commit as `feat(turbo-repo-cache)!:` (new runner/npm prerequisites)

## Verification

```bash
# static
pre-commit run --all-files
zizmor --persona regular --offline .github/workflows/ .github/actions/

# local functional run of the nested action, emulating the runner contract
cd .github/actions/turbo-repo-cache/server && export RUNNER_TEMP=$(mktemp -d) GITHUB_ENV=$RUNNER_TEMP/env GITHUB_STATE=$RUNNER_TEMP/state \
  INPUT_STORAGE-PROVIDER=local INPUT_STORAGE-PATH=$RUNNER_TEMP/store INPUT_TEAM-ID=ci
node start.cjs && cat "$GITHUB_ENV" && STATE_pid=$(sed -n 's/^pid=//p' "$GITHUB_STATE") STATE_log_dir=$(sed -n 's/^log_dir=//p' "$GITHUB_STATE") node stop.cjs
```

CI: the `turbo-repo-cache-test.yml` job must pass on the PR.

## Notes / Deferred

- **Rejected: fork the upstream repo.** Inherits an ncc build, a 17 MB committed
  `dist/`, and a separate release pipeline for glue code.
- **Rejected: run the GHCR container.** Needs Docker on every runner and mounting
  the WIF credential file plus the token file it references into the container.
- **Rejected: shell-only composite.** Composite actions have no `post` hook, so
  the server would be orphaned on self-hosted runners. The nested node action
  exists solely to get `post`; keeping it dependency-free avoids any bundle step.
- **Rejected: `actions/setup-node` inside the action.** It would change the
  consumer's node version for the rest of the job. `npm` on PATH is documented as
  a prerequisite instead; the server itself runs on the runner's node24 via
  `process.execPath`, so the consumer's node version is irrelevant.
- **No install cache.** Cold `npm ci` of the server measured ~7 s; not worth an
  `actions/cache` layer (and `hashFiles` cannot see `github.action_path`).
- Server crash mid-job is surfaced as a warning by `post`, not a failure: turbo
  degrades to cache misses, and failing a green build over a cache server is worse.
- Deferred: `port` / `host` inputs upstream offered. Bind is fixed to loopback and
  the port is always a free one; add inputs only if a consumer needs them.
- Renovate: the existing `.github/actions/turbo-repo-cache/**` packageRule
  already scopes the npm bump to `chore(turbo-repo-cache)`; nothing to wire.
