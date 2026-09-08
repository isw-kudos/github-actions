# Progress — stefan-hattrell

## 2026-09-08
### Accomplished
- Migrated `isw-kudos/devops` `docker-build-generic.yml` into this repo as the
  `docker-build-ghcr` component (`.github/workflows/docker-build-ghcr.yml`),
  inputs name-for-name identical so the 20 callers in boards (7), collab (9)
  and huddo-services (4) change only their `uses:` line.
- Hardening vs the original: SHA-pinned actions, `permissions: {}` + job grant,
  `persist-credentials: false`, app token scoped to the caller plus its
  same-owner submodules (parsed from `.gitmodules`, allowlisted) with
  `permission-contents: read`, declared `secrets.HUDDO_DEVOPS_GITHUB_APP_PRIVATE_KEY`
  so callers can drop `secrets: inherit`, `outputs.digest`, concurrency group
  keyed by image, QEMU only for non-amd64.
- Full component wiring: `.releaserc.js`, `release-docker-build-ghcr.yml`,
  renovate scope rule, commit-msg hook case, docs/CLAUDE.md/README tables.
- Plan: `docs/plans/2026-09-08-docker-build-ghcr-migration.md`. Independent
  adversarial review found the detect pipeline failed under `pipefail` on an
  empty match; fixed and re-verified by running the extracted step against
  boards' real `.gitmodules`.

### Decisions
- Separate component rather than a registry switch on the ECR `docker-build.yml`:
  that workflow is `vars`-driven and AWS-shaped; a mode flag would double its
  inputs and force a major on the erc-* consumers.
- Kept the two-checkout dance: `secrets` is unavailable in step `if:`, so
  `.gitmodules` on disk stays the signal for needing the app token.
- `vars.HUDDO_DEVOPS_GITHUB_APP_ID` stays a `vars` lookup (resolves against the
  caller's org); an input default cannot reference `vars`.

### Next Steps
- Commit as `feat(docker-build-ghcr): migrate docker-build-generic from devops`
  and open the PR (draft first). With no prior tag semantic-release cuts
  `docker-build-ghcr-v1.0.0` on merge; no seed tag needed.
- Re-point one huddo-services caller first (no submodule, no secret), then a
  boards caller with the explicit `secrets:` mapping and its
  `zizmor: ignore[secrets-inherit]` removed, then the remaining 18.
- Once all callers are moved, delete `docker-build-generic.yml` from devops.
- Next devops workflows to migrate: continue the same pattern.

## 2026-09-08 (earlier)
Replaced the unmaintained turbo-repo-cache upstream with an in-house node24
server sub-action (PR #19, released as `turbo-repo-cache-v2.0.0`), then fixed
all seven components to the `conventionalcommits` preset so `type(scope)!:`
releases a major (PR #20).

## 2026-09-07
Audited `required-checks.yml` for draft-PR bypass (safe; invariant documented,
PR #16) and hand-rolled the pre-commit wrapper steps with SHA-pinned
`actions/cache` (PR #17, merged). Admin follow-up still open: drop
`pre-commit/action@*` from the repo allowed-actions patterns.
