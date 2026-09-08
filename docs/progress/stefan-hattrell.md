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

- PR #24 merged, but `release-docker-build-ghcr` failed in `generateNotes`:
  Renovate #21 had bumped `conventional-changelog-conventionalcommits` to v10,
  which needs `conventional-changelog-writer@9`, while
  `@semantic-release/release-notes-generator` 14.x (semantic-release 25)
  bundles writer 8. Pinned the preset back to 9.3.1 in all eight release
  workflows and added a Renovate `allowedVersions: "<10"` hold; verified with
  a local `semantic-release --dry-run` that now reaches "Published release 1.0.0".

### Next Steps
- Merge the preset-pin fix, then `gh workflow run release-docker-build-ghcr.yml`
  (the release workflow's `paths:` filter does not cover `release-*.yml`, so
  the fix landing on main will not re-trigger it).
- Drop the Renovate hold once semantic-release depends on
  release-notes-generator 15 (writer 9).
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
