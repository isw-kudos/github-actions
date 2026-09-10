# ghcr.io image tagging, promote-by-pin, and package hygiene

## Context

Every ghcr.io image in isw-kudos (huddo-services: 4, collab: 10, boards: 7) is
built by the `docker-build-ghcr` component and pushed under exactly one tag,
which each of the 21 caller workflows computes with the same expression:

```yaml
tag: ${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || github.ref_name }}
```

Three problems follow from "one tag per build, chosen by the caller":

1. **Nothing identifies a build by its commit.** collab and boards promote to
   prod by retagging `main` -> `prod` / `cloud` across their own images *and*
   the shared huddo-services images (`retag-images-ghcr`, PRs collab#866 and
   boards#392). huddo-services `main` is whatever huddo-services last built,
   not the commit each app's `huddo-services` submodule pins: on 2026-09-10
   collab pinned `8a78fdea` (21 commits behind) and boards `ee802d47`. A promote
   ships huddo-services code the app never compiled against. The submodule
   commit is readable without a checkout of the submodule
   (`git rev-parse HEAD:huddo-services`), but no tag names that build.
2. **No OCI labels.** `crane config ghcr.io/isw-kudos/user:main` has
   `Labels: null`; a manifest cannot be traced to a commit.
3. **Untagged versions pile up.** Counted on 2026-09-10:

   | package | versions | tagged | untagged |
   |---|---|---|---|
   | user | 1479 | 133 | 1346 |
   | user-buildcache | 517 | 1 | 516 |
   | huddo-core | 1300 | 114 | 1186 |
   | boards-core | 3052 | 225 | 2827 |

   Confirmed causes: (a) every push to `main` / `pr-N` re-points the tag and
   orphans the previous OCI index and its children; (b) every tagged index has
   **two untagged children** (the `linux/amd64` manifest and the buildx
   provenance `attestation-manifest`) which must never be deleted while the
   index is tagged; (c) `<image>-buildcache:latest` is re-pointed on every
   build (`mode=max`), orphaning the previous cache manifest. Nothing carries
   OCI labels, so age is the only signal.

Facts that differ from the brief: boards already merged its migration to
`docker-build-ghcr-v1.0.0` (boards#384, 7 workflows); the local
`ci/migrate-docker-build-ghcr` branch is stale. The only caller left on devops
`docker-build-generic.yml` is collab `build-search.yml` (added by collab#586
after the migration PR was cut, not by design); devops has since deleted that
workflow from `master`, so the pin works only because it is a SHA. huddo-services
`build-*.yaml` are `paths:`-filtered on push: commit `ee802d47` (boards' pin)
built **only** `provider`, so a per-commit tag would not exist on `user` /
`licence` / `socketcluster` for that commit. dev8 (collab) and staging (boards)
run huddo-services at `main`, so no environment exercises the pinned
combination today.

Out of scope: cross-registry (quay) publishing, deploying dev8/staging from the
pin, cleanup of packages not built by these three repos (`collab-*`, `store-*`,
`auth-basic`, `user-basic`, `huddo-support-bot`, `foundry`, `kutt`, `charts/*`).

## Architecture

```
 build (push main / pull_request / workflow_dispatch)          github-actions
 ┌───────────────────────────────────────────────────────────────────────────┐
 │ docker-build-ghcr.yml                                                     │
 │   metadata-action ──► tags:  main | dev | pr-N | sha-<40 hex> [+ inputs.tag]│
 │                       labels + index annotations: org.opencontainers.*     │
 │   build-push-action ─► ghcr.io/isw-kudos/<image>:{tags}                    │
 │                        ghcr.io/isw-kudos/<image>-buildcache:latest         │
 └───────────────────────────────────────────────────────────────────────────┘
        ▲ huddo-services: every push to main builds all 4 images (no paths:
        │ filter on push) so sha-<commit> exists on every image for every commit

 promote (collab promote-main-to-prod / boards promote-main-to-cloud)
 ┌────────────┐  HEAD:huddo-services  ┌──────────────────────────────────────┐
 │ resolve-pin│ ────────────────────► │ retag-images.y(a)ml (wrapper)         │
 │ contents:  │  huddoServicesSourceTag│  1. huddo-services images:            │
 │ read       │  = sha-<pin>           │     sha-<pin> ──► prod|cloud          │
 └────────────┘                        │  2. app images:  main ──► prod|cloud  │
                                       │  (two retag-images-ghcr calls, 2 needs 1)│
                                       └──────────────────────────────────────┘
   *-last-working snapshot and rollback: unchanged (one source tag, both lists)

 hygiene (weekly, per publishing repo)                          github-actions
 ┌───────────────────────────────────────────────────────────────────────────┐
 │ cleanup-images-ghcr.yml  ──► dataaxiom/ghcr-cleanup-action                 │
 │   packages (one per line) │ dry_run (default true) │ older_than            │
 │   delete_tags │ exclude_tags                                               │
 │   walks every index, drops its children from the candidate set, then       │
 │   deletes untagged versions (and matching tags) older than the cut-off     │
 └───────────────────────────────────────────────────────────────────────────┘
   huddo-services: user provider licence socketcluster (+ -buildcache)
   collab:         huddo-{core,acl,attachments,discussions,notifications,ideas,search,wikis,wikishift,editor} (+ -buildcache)
   boards:         boards boards-core boards-event boards-mcp boards-webfront notification activity-migration (+ -buildcache)
```

## Key interfaces

### docker-build-ghcr (minor, `feat(docker-build-ghcr)`)

Tags are generated inside the component with `docker/metadata-action`:

| Event | Tags pushed |
|---|---|
| push to a branch | `<branch>` (`main`, `dev`), `sha-<full sha>` |
| pull_request | `pr-<number>`, `sha-<PR head sha>` |
| workflow_dispatch | `<branch>`, `sha-<full sha>` |
| push of a git tag | `<tag>`, `sha-<full sha>` |

`sha-` is metadata-action's default prefix; `format=long` gives the full 40
hex chars so the tag is unambiguous and the promote can build it from
`git rev-parse` without truncation rules. `DOCKER_METADATA_PR_HEAD_SHA=true` so a
PR build is tagged with a commit that exists in the repository, not the
ephemeral `refs/pull/N/merge` commit. `flavor: latest=false`; no date tag (see
Notes). `inputs.tag` becomes optional and, when set, is pushed as one more
tag (`type=raw`), so v1.0.0 callers keep working unchanged.

Labels (`labels:`) and annotations (`annotations:`, levels `manifest,index`)
from metadata-action: `org.opencontainers.image.{created,revision,source,
version,title,description,url,licenses}`. `revision` is the same sha as the tag.

New output `tags` (newline list of pushed references) beside `digest`.

### cleanup-images-ghcr (new component, `feat(cleanup-images-ghcr)`)

`on.workflow_call` inputs:

| Input | Default | Notes |
|---|---|---|
| `packages` | required | One package name per line under `ghcr.io/<caller owner>`; allowlisted with the same OCI name regex as `retag-images-ghcr`. |
| `dry_run` | `true` | Log only. Callers must opt in to deletion. |
| `older_than` | `7 days` | human-interval; every rule applies only to versions older than this. |
| `delete_tags` | `''` | Comma-separated wildcard tag patterns to delete as well (e.g. `pr-*,sha-*`). |
| `exclude_tags` | `''` | Tag patterns never touched. |

Always `delete-untagged: true` and `validate: true`. Auth is the caller's
`GITHUB_TOKEN` with `packages: write`; deletion needs the calling repo to hold
Admin on each package, which the publishing repo has (all 21 packages are
linked to the repo that builds them). Concurrency group per calling repo, no
cancel (the action is not parallel-safe on one package).

Consumer schedule (weekly, Sunday 16:00 UTC), three jobs per repo, all dry-run
until the first log is reviewed:

| Job | packages | older_than | delete_tags |
|---|---|---|---|
| untagged | images | 7 days | – |
| stale-tags | images | 90 days | `pr-*,sha-*` (a version that also carries `prod`/`cloud`/`*-last-working`/`main` only loses the matched tag) |

"Older than" is the package version's `updated_at`, which a retag onto the
version bumps, so a `sha-` version that was promoted recently is protected for
another window regardless of build date. The first PR per repo hardcodes
`dry_run: true` with no dispatch input, so nothing can delete before the log
has been read.
| buildcache | `<image>-buildcache` | 1 day | – |

### Promote by pin (collab, boards wrappers)

`retag-images.y(a)ml` gains an optional input `huddoServicesSourceTag`
(default `''` = same as `sourceTag`) and splits into two jobs: `huddo-services`
(source `huddoServicesSourceTag || sourceTag`) then `apps` (`needs:
huddo-services`, source `sourceTag`). The huddo-services call runs first so a
missing `sha-<pin>` tag fails before any app tag has moved. Promote workflows
add a `resolve-pin` job:

```yaml
resolve-pin:
  permissions: { contents: read }
  outputs: { huddo_services_sha: ${{ steps.pin.outputs.sha }} }
  steps:
    - checkout (persist-credentials: false)     # no submodules: the gitlink is enough
    - run: sha=$(git rev-parse HEAD:huddo-services); [[ $sha =~ ^[0-9a-f]{40}$ ]]; echo "sha=$sha" >> "$GITHUB_OUTPUT"
```

and pass `huddoServicesSourceTag: sha-${{ needs.resolve-pin.outputs.huddo_services_sha }}`
to the main-to-prod / main-to-cloud job only.

## Implementation Order

- [x] 1. Plan committed (this file), progress log entry.
- [x] 2. (PR #52) `docker-build-ghcr.yml`: metadata-action step, `tag` optional, labels +
      annotations, `tags` output; README + `docs/per-component-versioning.md`.
      PR title `feat(docker-build-ghcr): generate tags and OCI labels with metadata-action`.
- [x] 3. (PR #53) `cleanup-images-ghcr.yml` (no hand-seeded tag: semantic-release cuts
      `cleanup-images-ghcr-v1.0.0` from the first scoped `feat` commit, as it did
      for `retag-images-ghcr`) + `releases/cleanup-images-ghcr/.releaserc.js`
      + `release-cleanup-images-ghcr.yml` + renovate rule + scope-hook case +
      docs/CLAUDE/README. PR title `feat(cleanup-images-ghcr): scheduled ghcr.io package cleanup`.
      _deviation: concurrency moved from the workflow level to the job, since a
      called workflow's top-level `concurrency` could not be confirmed to apply;
      callers chain their jobs with `needs` because GitHub keeps one pending job
      per group._
- [ ] 4. _(prepared in a worktree, uncommitted; awaiting the release pin / approval)_ huddo-services: bump the four `build-*.yaml` to `docker-build-ghcr-v1.1.0`,
      drop `tag:`. Depends on 2 released.
      _deviation: the "drop `paths:` on push" half is parked with the pinning
      work (see 7/8); it only existed to guarantee a `sha-` tag on every image
      for every main commit._
- [ ] 5. _(prepared in a worktree, uncommitted; awaiting the release pin / approval)_ collab: bump nine `build-*.yml`, drop `tag:`; migrate `build-search.yml`
      to the component (drop `id-token: write` and `secrets: inherit`); delete
      the devops freeze rule in `renovate.json` and the `secrets: inherit`
      exception in the gha-security skill. Depends on 2 released.
      _deviation: stacked on collab#866 (it rewrites the same renovate/skill
      paragraphs); after both, no devops ref is left in collab._
- [ ] 6. _(prepared in a worktree, uncommitted; awaiting the release pin / approval)_ boards: bump seven `build-*.yaml`, drop `tag:`; delete the dead
      `build-*.yaml` devops freeze rule and the skill exception. Depends on 2
      released. _deviation: stacked on boards#392 for the same reason as 5._
- [~] 7. collab#874 (draft, PAUSED 2026-09-10): promote by pin (wrapper + `promote-main-to-prod.yml`).
      _deviation: collab#866 squash-merged first, so this is based on main, not
      stacked; merge gate: a huddo-services pin built after step 4._
- [~] 8. boards#400 (draft, PAUSED 2026-09-10): promote by pin (wrapper + `promote-main-to-cloud.yaml`).
      _deviation: same as 7 (boards#392 merged first); also reworded the
      `docker-compose.smoke.yaml` header, which asserted the pre-pin behaviour._
- [ ] 9. _(prepared in a worktree, uncommitted; awaiting the release pin / approval)_ huddo-services / collab / boards: `cleanup-images.y(a)ml` scheduled
      workflow, dry-run. Depends on 3 released.
- [ ] 10. Run each cleanup workflow by dispatch (dry run), paste the "would
      delete" counts here, confirm in Package settings -> Manage Actions access
      that the repo holds Admin on one package of each kind (a dry run never
      issues a DELETE, so the first real run is the first authorisation test),
      get explicit approval, then a follow-up PR per repo replaces the
      hardcoded `dry_run: true` with a `workflow_dispatch` input and a real
      scheduled run.
- [ ] 11. Progress log updated; this plan annotated with what actually happened.

## Verification

```bash
# github-actions (both PR branches)
zizmor --persona regular --offline .github/workflows/
pre-commit run --all-files
node -e "require('./releases/cleanup-images-ghcr/.releaserc.js')"

# consumer worktrees
zizmor --persona regular --offline .github/workflows/

# after the v1.1.0 pin lands: tags on a fresh build (push to main of huddo-services)
crane ls ghcr.io/isw-kudos/user | grep -E "^(main|sha-)"          # main + sha-<sha of that push>
crane manifest ghcr.io/isw-kudos/user:main | jq .annotations       # org.opencontainers.image.revision = that sha
crane config ghcr.io/isw-kudos/user:main --platform linux/amd64 | jq .config.Labels

# promote from a pinned commit tag (collab, after 4 + 7 are merged and the pin is a post-4 commit)
gh workflow run promote-main-to-prod.yml -R isw-kudos/collab -f saveLastWorking=true
crane digest ghcr.io/isw-kudos/user:prod == crane digest ghcr.io/isw-kudos/user:sha-$(git -C collab rev-parse origin/main:huddo-services)

# hygiene dry run
gh workflow run cleanup-images.yaml -R isw-kudos/huddo-services -f dry_run=true
# read the job log: per package "would delete N untagged / N tagged", validate: no missing children
```

## Notes / Deferred

- **Pinning paused (2026-09-10).** Focus is the metadata-action tags and the
  cleanup component; collab#874 and boards#400 stay open as drafts and the
  huddo-services `paths:` change is parked with them. Everything else in this
  plan stands; the `sha-` tags still ship so the pinning work can resume
  without a component change.

- **metadata-action, not a caller expression.** Every caller had the same
  expression; the component owns the tag set now so a new tag (the commit tag)
  reaches 21 workflows through one pin bump.
- **No date tag.** A date is not unique per build (two builds on one day fight
  over it), nothing deploys by date, and `org.opencontainers.image.created`
  plus the package version's `created_at` already record it. boards' quay
  publishing uses dated tags but that is a separate, deliberate release flow.
- **No `latest`.** Nothing deploys it and it would be one more moving alias to
  keep out of hygiene rules.
- **Full sha, default `sha-` prefix.** The promote computes the tag from
  `git rev-parse` output; a short sha would need an agreed length in two repos.
- **PR head sha, not merge sha.** The merge commit is unreachable once the PR
  updates; the head sha is a commit in the repository.
- **Additive, not breaking.** `inputs.tag` stays and is pushed verbatim when
  given, so v1.0.0 callers get `sha-` tags via a plain Renovate minor bump.
  Removing the input is a later `feat(docker-build-ghcr)!:` once no caller
  passes it.
- **huddo-services builds every image on every main push.** The alternative,
  a retag step that stamps `sha-<commit>` onto the unchanged images' current
  `main`, needs the builds to have finished first and would tag an image with
  a commit it was not built from. Four cached builds per main push is the
  honest invariant. `pull_request` keeps its `paths:` filters.
- **The wrapper is now two retag calls, so "nothing moves on a missing
  source" holds per call, not across both lists.** For a promote that is the
  point (a never-built pin fails first). For a snapshot or rollback a source
  missing on an *app* image (a newly added image, say) now leaves the
  huddo-services tags moved and the app tags not; before, nothing moved.
  Accepted for now because a re-run after fixing the missing image completes
  the move. Deferred: a `check_only` input on `retag-images-ghcr` so the
  wrapper can preflight both lists before either writes.
- **Build concurrency is keyed by commit outside PRs.** GitHub keeps one
  pending run per group and drops the older one, so three fast pushes to main
  with a per-ref group would leave the middle commit with no `sha-` tag; with
  huddo-services building every image per push that was a real risk.
- **Promote refuses a non-main dispatch.** `resolve-pin` reads the pin from
  the dispatched ref while the app images always come from `main`; running it
  from another branch would pair that branch's pin with main's apps.
- **Promote order: huddo-services first, then apps.** The first promote after
  this lands needs a pin built after step 4 shipped or `sha-<pin>` will not
  exist; failing there leaves nothing moved. A failure in the second call
  leaves huddo-services promoted and apps not, the same partial state one
  failed image produces today, and `*-last-working` still covers rollback.
- **Rejected: promoting app images by sha too.** App builds are `paths:`
  filtered as well, so `sha-<HEAD>` is not guaranteed on every app image;
  `main` keeps today's semantics.
- **dataaxiom/ghcr-cleanup-action over actions/delete-package-versions.** The
  GitHub action works on package-version ids with no manifest awareness; with
  `delete-only-untagged-versions` it would delete the two untagged children
  every tagged index here references and break every pull. dataaxiom walks
  each index and removes children (platform manifests, attestations, cosign
  referrers) from the candidate set before applying rules, and `validate`
  reports any index left with missing children. snok/container-retention-policy
  has the same manifest gap.
- **`older_than` on untagged is a race guard, not retention.** An untagged
  index is unreachable by tag already; 7 days gives room to restore a digest
  by API if a `main` move needs undoing before `*-last-working` catches it.
  buildcache orphans are worthless once superseded: 1 day.
- **`sha-*` tags replace the untagged pile with a tagged one** unless pruned,
  hence the `stale-tags` job. 90 days covers any plausible "promote an older
  pin" while keeping growth bounded (roughly the last quarter of commits per
  image); "old" is last-updated, see Key interfaces.
- **Package admin:** each cleanup runs in the repo that publishes the package
  (`repository.full_name` on all 21 packages), so `GITHUB_TOKEN` suffices and
  no PAT is introduced.
- Deferred: dev8/staging deploying huddo-services from the pin (deploy
  workflows already accept a `huddoServicesTag` input, so `sha-<pin>` can be
  passed today by hand); a PR-close cleanup of `pr-N`; removing `inputs.tag`;
  cleanup of the other org packages; renovate for `dataaxiom/ghcr-cleanup-action`
  is covered by the existing github-actions manager.
