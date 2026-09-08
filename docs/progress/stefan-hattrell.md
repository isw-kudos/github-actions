# Progress — stefan-hattrell

## 2026-09-08
### Accomplished
- Replaced `trappar/turborepo-remote-cache-gh-action` (pinned at the 2023
  `v1` tag, `node16`, maintainer unresponsive) inside
  `.github/actions/turbo-repo-cache` with an in-house `server/` sub-action:
  zero-dependency node24 `start.cjs`/`stop.cjs` that `npm ci`s a pinned
  `turborepo-remote-cache` (2.12.3), runs it detached on loopback, exports
  `TURBO_*`, and reaps it in `post`. Composite calls it via `$/`.
- Added `turbo-repo-cache-test.yml` (local-storage smoke test with a curl
  artifact round-trip) and listed it in the required-checks gate.
- Plan: `docs/plans/2026-09-08-turbo-repo-cache-inhouse-server.md`.
- Opened PR #19 (draft). Independent Opus review found six real defects
  (job-env leaking into the server, consumer npm registry config honoured,
  shared install dir wiped by a second use, unguarded kill in post, local
  storage-path rejoined under tmpdir, pid saved after readiness); all fixed
  and re-verified locally, recorded in the plan's "Review fixes" section.

- PR #19 merged, but `release-turbo-repo-cache` cut nothing: the squash
  commit `feat(turbo-repo-cache)!: ...` was not parsed by commit-analyzer's
  default angular preset (`!` breaks its header regex), and the squash setting
  blanks the body so the `BREAKING CHANGE:` footer was lost. Fixed all seven
  components with `preset: 'conventionalcommits'` + the preset package on the
  `npx` line, a Renovate regex manager for those pins, and `!` support in the
  commit-scope hook. v2.0.0 must be re-released via `workflow_dispatch`.

### Decisions
- Nested node action instead of shell-only composite purely to get a `post`
  hook (orphaned server on self-hosted runners otherwise). Zero deps so there
  is no ncc/dist bundle to maintain.
- Server runs on the runner's node24 (`process.execPath`); only `npm` on PATH
  is a prerequisite. No `setup-node` inside the action (would clobber the
  consumer's node version).
- Dead server at job end is a warning, not a failure (turbo degrades to misses).
- Release as `feat(turbo-repo-cache)!` — new runner >= 2.336.0 and npm
  prerequisites for consumers.

### Next Steps
- Open the PR (draft first per the `pr` skill), confirm the smoke test and
  zizmor pass in CI, then bump huddo's pin to `turbo-repo-cache-v2.0.0`.
- Watch the first real GCS run: ADC via `GOOGLE_APPLICATION_CREDENTIALS` is
  the same path the old action used, but verify the post-step log group.

## 2026-09-07
Audited `required-checks.yml` for draft-PR bypass (safe; invariant documented,
PR #16) and hand-rolled the pre-commit wrapper steps with SHA-pinned
`actions/cache` (PR #17, merged). Admin follow-up still open: drop
`pre-commit/action@*` from the repo allowed-actions patterns.
