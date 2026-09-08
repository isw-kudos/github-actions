# turbo-repo-cache

Composite action that authenticates to Google Cloud via workload identity
federation and starts a [turborepo-remote-cache](https://github.com/ducktors/turborepo-remote-cache)
server on `127.0.0.1` for the rest of the job, backed by a GCS bucket. Every
later `turbo` step in the job reads and writes its cache through that server.
The server is stopped, and its logs printed, when the job ends.

## Usage

```yaml
permissions:
  contents: read
  id-token: write # OIDC federation for google-github-actions/auth

steps:
  - uses: actions/checkout@<sha> # v7
  - uses: actions/setup-node@<sha> # v6  -- npm must be on PATH before this action
    with:
      node-version: 24
  - uses: isw-kudos/github-actions/.github/actions/turbo-repo-cache@turbo-repo-cache-v2.0.0
    with:
      workload-identity-provider: projects/123/locations/global/workloadIdentityPools/POOL/providers/PROVIDER
      service-account: turbo-cache@my-project.iam.gserviceaccount.com
      storage-path: my-turbo-cache-bucket
  - run: npx turbo build
```

## Inputs

| Input | Required | Default | Purpose |
|---|---|---|---|
| `workload-identity-provider` | yes | | Full resource name of the GCP workload identity provider |
| `service-account` | yes | | GCP service account email to impersonate |
| `storage-path` | yes | | GCS bucket name |
| `storage-provider` | no | `google-cloud-storage` | Server storage backend. Only GCS gets credentials from this action |
| `team-id` | no | `ci` | Exported as `TURBO_TEAM`; namespaces cache entries inside the bucket |

## Exported environment

| Variable | Value |
|---|---|
| `TURBO_API` | `http://127.0.0.1:<free port>` |
| `TURBO_TOKEN` | Random 48-hex token, unique per job and masked in logs |
| `TURBO_TEAM` | The `team-id` input |

## Prerequisites

- **npm on PATH.** The server package is pinned in `server/package.json` and
  installed with `npm ci` when the action starts (about 7 s cold), into a
  per-invocation directory under the runner temp path, always from the public
  npm registry regardless of the job's npm configuration. The server itself
  runs on the runner's bundled Node 24, so the job's own Node version is
  irrelevant.
- **Runner 2.336.0 or newer.** The composite calls its `server/` sub-action via
  the `$/` self-repository reference so both are always at the same commit.
- **Linux or macOS runner.**

## How it works

```
action.yml (composite)
  ├─ google-github-actions/auth  -> GOOGLE_APPLICATION_CREDENTIALS
  └─ server/ (node24, zero dependencies)
       start.cjs : validate inputs, npm ci, free port + random token,
                   spawn detached `turborepo-remote-cache` with an
                   allowlisted env, wait for GET /v8/artifacts/status == 200,
                   export TURBO_*
       stop.cjs  : post hook; SIGTERM the server, print its log tail
```

The GCS provider in `turborepo-remote-cache` uses Application Default
Credentials when no explicit `GCS_*` key is set, which is what the auth step
provides. The server does not inherit the job's environment: only `PATH`,
`HOME`, proxy and CA variables, and cloud credential variables (`GOOGLE_*`,
`GCLOUD_*`, `CLOUDSDK_*`, `GCS_*`, `AWS_*`, `S3_*`, `ABS_*`, `AZURE_*`) are
passed through, and `NODE_ENV` is pinned to `production`. This stops a
consumer's `NODE_ENV=development` or root `.env` from silently reconfiguring
the cache (for example into read-only mode).

A server that dies mid-job is reported as a warning by the post step rather
than a failure: `turbo` degrades to cache misses. The post step prints the
last 200 lines of the server log as a visible group on that path; on a healthy
stop they are emitted as `::debug::` lines, shown when step debug logging is
enabled.

`server/` can be used on its own (`storage-provider: local` with a directory
path, honoured literally, or with your own cloud credentials in the step's
`env`); the smoke test in `.github/workflows/turbo-repo-cache-test.yml` does
exactly that.

## Versioning

Released as `turbo-repo-cache-vX.Y.Z`; commits touching this directory use the
`turbo-repo-cache` scope. Renovate bumps `turborepo-remote-cache` in
`server/package.json` as `chore(turbo-repo-cache)`, producing a patch release.
