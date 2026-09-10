# Progress — stefan-hattrell

## 2026-09-10 (ghcr tagging, promote by pin, hygiene)
### Accomplished
- Plan `docs/plans/2026-09-10-ghcr-image-tagging-and-hygiene.md`.
- `docker-build-ghcr` (branch `ci/ghcr-image-tagging`): tags now come from
  `docker/metadata-action` inside the component: `<branch>` / `pr-N` / git
  tag plus `sha-<full sha>` on every build, OCI labels and index annotations
  (`revision` = the sha), `tags` output; `tag` input deprecated but still
  pushed when given, so v1.0.0 callers keep working (`feat`, minor).
- New `cleanup-images-ghcr` component (branch `ci/cleanup-images-ghcr`, own
  worktree): wraps `dataaxiom/ghcr-cleanup-action` v1.2.2 with allowlisted
  `packages` / `older_than` / `delete_tags` / `exclude_tags`, `dry_run`
  default true, job-level concurrency per caller; full release wiring.
- Consumer worktrees prepared (uncommitted, pins are a 0000… placeholder
  until `docker-build-ghcr-v1.1.0` / `cleanup-images-ghcr-v1.0.0` exist):
  huddo-services (4 builds: drop `tag:`, drop `paths:` on push so every main
  commit builds every image), collab (9 builds + `build-search.yml` off
  devops), boards (7 builds); promote-by-pin on top of collab#866 /
  boards#392 (`huddoServicesSourceTag`, wrapper split into huddo-services →
  apps jobs, `resolve-pin` job in the promote workflows); weekly
  `cleanup-images.y(a)ml` in all three, three chained dry-run passes
  (untagged 7d, `pr-*,sha-*` 90d, buildcache 1d).
- Adversarial review (one agent) led to: build concurrency keyed by commit
  outside PRs, a main-only guard in `resolve-pin`, honest two-phase wording in
  the wrappers, hardcoded `dry_run: true` with no dispatch switch in the first
  cleanup PRs, `!cancelled()` on the chained passes, "last updated" wording,
  and the collab/boards build PRs stacked on #866 / #392 so the devops freeze
  rules and the skill's `secrets: inherit` exception can go in the same PR.
- zizmor clean on all ten worktrees; check script exercised with hostile
  inputs; pre-commit could not install hooks (SSH agent refused to sign), so
  whitespace/EOF/YAML parse were run by hand and renovate-config-validator
  directly.

### Decisions
- Full sha with metadata-action's default `sha-` prefix; PR builds tagged
  with the PR head sha (`DOCKER_METADATA_PR_HEAD_SHA`), no date, no `latest`.
- huddo-services builds every image on every main push rather than
  back-tagging unchanged images with a commit they were not built from.
- dataaxiom over `actions/delete-package-versions`: every tagged index here
  has two untagged children (amd64 manifest + attestation) the latter would
  delete.
- Promote runs the huddo-services retag first so a never-built pin fails
  before any app tag moves.

### Next Steps
- Approve + open: github-actions PRs (docker-build-ghcr, cleanup-images-ghcr);
  after each release fill the placeholder pins and open the consumer PRs;
  merge collab#866 / boards#392 first so the promote-by-pin PRs retarget.
- Dispatch each `cleanup-images` workflow as a dry run, review counts, then
  flip the scheduled `dry_run` per repo.
- Follow-ups: delete collab's devops freeze rule once #866 and the
  build-search migration are both in; dev8/staging from the pin.

## 2026-09-09 (retag-images-ghcr)
Added the `retag-images-ghcr` component (parallel `crane tag` by resolved
digest across a newline image list, preflight before any write, summary
table) with full wiring and plan; consumer wrappers drafted as collab#866 and
boards#392. Released as `retag-images-ghcr-v1.0.0` (PR #39).

## 2026-09-09 (helm-deploy)
Added the `helm-deploy` component (one `helm upgrade --install` for GKE via
Workload Identity and kubeconfig targets, replacing devops `deploy-gcloud.yaml`
/ `deploy-helm-in-isw.yaml`) with full component wiring and a plan carrying
the eight-caller migration table; `wait` + rollback on by default.

## 2026-09-08
Migrated devops `docker-build-generic.yml` here as the `docker-build-ghcr`
component (PR #24, `docker-build-ghcr-v1.0.0`), then pinned the
`conventionalcommits` preset below 10 across all release workflows after the
first release failed in `generateNotes`. Consumer re-pointing still pending.

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
