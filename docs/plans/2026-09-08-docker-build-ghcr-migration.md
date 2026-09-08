# docker-build-ghcr: migrate `docker-build-generic.yml` from isw-kudos/devops

## Context

`isw-kudos/devops/.github/workflows/docker-build-generic.yml` (pinned by consumers
at `7af47bb`, collab still at `8c00195`) builds an image from the checked-out
workspace and pushes it to `ghcr.io/<owner>/<image>:<tag>` with a registry build
cache. Twenty caller workflows use it: 7 in `boards`, 9 in `collab`, 4 in
`huddo-services`. `boards` and `collab` carry `huddo-services` as a private git
submodule, so the workflow mints a GitHub App token to check it out when a
`.gitmodules` file exists.

This repo is becoming the canonical home for shared workflows. The existing
`docker-build.yml` here is ECR/AWS-OIDC specific (`vars.ECR_*`, `role-to-assume`),
so the GHCR flavour lands as its own component rather than being folded in.

Goal: a like-for-like `docker-build-ghcr.yml` component, brought up to this
repo's security baseline, with the input surface unchanged so consumer diffs are
one `uses:` line (plus the now-possible explicit `secrets:` mapping).

Out of scope: editing the consumer repos (separate PRs, after the first tag
exists), deleting the devops copy, unifying with the ECR `docker-build.yml`.

## Architecture

```
caller (boards/collab/huddo-services build-*.yml)
  uses: isw-kudos/github-actions/.github/workflows/docker-build-ghcr.yml@<sha> # docker-build-ghcr-vX.Y.Z
  with: { image, tag, dockerfile_path, [build_args], [context], [architecture] }
  secrets: { HUDDO_DEVOPS_GITHUB_APP_PRIVATE_KEY }   # only repos with a private submodule
    │
    ▼
  build (ubuntu-latest, contents: read + packages: write)
    1. checkout (persist-credentials: false)
    2. .gitmodules present?  ──yes──▶ create-github-app-token (contents: read,
    │                                  repositories: <caller>,<same-owner submodules>)
    │                                  checkout again, submodules: recursive, app token
    3. login ghcr.io (GITHUB_TOKEN)
    4. setup-qemu + setup-buildx
    5. build-push-action
         context: inputs.context (workspace, so .dockerignore applies)
         tags:    ghcr.io/<owner>/<image>:<tag>
         cache:   ghcr.io/<owner>/<image>-buildcache:latest (registry, mode=max)
    ▶ outputs.digest
```

## Key interfaces

Inputs are identical to the devops workflow: `image` (required), `tag` (required),
`dockerfile_path` (default `Dockerfile`), `build_args`, `context` (default `.`),
`architecture` (default `linux/amd64`).

New, additive:

- `secrets.HUDDO_DEVOPS_GITHUB_APP_PRIVATE_KEY` (`required: false`) declared under
  `workflow_call`, so callers can pass it by name instead of `secrets: inherit`.
  Every consumer today carries a comment saying exactly this upstream fix is
  what would let them drop the `zizmor: ignore[secrets-inherit]`.
- `outputs.digest` (from `build-push-action`), matching `docker-build.yml`.

Component wiring: tag prefix `docker-build-ghcr-v`, scope `docker-build-ghcr`,
watched path `.github/workflows/docker-build-ghcr.yml`.

## Implementation Order

- [x] 1. Write `.github/workflows/docker-build-ghcr.yml` (SHA-pinned actions,
      `permissions: {}` + job grant, `persist-credentials: false`, app token with
      `permission-contents: read`, concurrency group keyed by image).
      _deviation: zizmor `github-app` (High) rejects an owner-wide token, so the
      detect step now parses `.gitmodules` and scopes `repositories:` to the
      caller plus its same-owner submodules. Review also found the pipeline
      died under `pipefail` on an empty match (`|| :` guards added, `shell: bash`
      made explicit) and QEMU now runs only for non-amd64 targets._
- [x] 2. `releases/docker-build-ghcr/.releaserc.js` (copy, change `scope`).
- [x] 3. `.github/workflows/release-docker-build-ghcr.yml` (copy, change `paths:`,
      tag glob, `working-directory`).
- [x] 4. `renovate.json` packageRule for the new file.
- [x] 5. `.github/scripts/check-component-scope.sh` case entry.
- [x] 6. Docs: `docs/per-component-versioning.md` tables, `CLAUDE.md` tables,
      `README.md` usage section.
- [x] 7. zizmor + pre-commit clean; independent review of the workflow.
- [x] 8. Progress log entry.

## Verification

```bash
zizmor --persona regular --offline .github/workflows/docker-build-ghcr.yml .github/workflows/release-docker-build-ghcr.yml
pre-commit run --all-files
node -e "require('./releases/docker-build-ghcr/.releaserc.js')"
```

Post-merge: the squash commit `feat(docker-build-ghcr): ...` triggers
`release-docker-build-ghcr.yml`; with no prior tag semantic-release cuts
`docker-build-ghcr-v1.0.0`. Then re-point one `huddo-services` caller (no
submodule, no secret) first, then a `boards` caller with the explicit secret.

## Notes / Deferred

- **Separate component, not a `registry` input on `docker-build.yml`.** The ECR
  workflow's auth, tagging (metadata-action) and cache repo are all `vars`-driven
  and AWS-shaped; a mode switch would double its input surface and force a major
  bump on the erc-* consumers for no benefit to them.
- **Kept the two-checkout dance.** `secrets` is not available in step `if:`, so
  presence of the private key cannot gate the app-token step; `.gitmodules` on
  disk remains the signal. A single checkout with `submodules: recursive` would
  need the token before the repo is on disk.
- **App token is repo-scoped, `contents: read`.** First cut was owner-wide (the
  devops behaviour) on the grounds that parsing `.gitmodules` was not worth the
  shell; zizmor's `github-app` audit flags owner-wide as High, and the parse is
  six lines with an allowlist, so the token is now limited to the caller and its
  same-owner submodules. URLs on other hosts or under other owners are dropped
  and surface as a checkout 403 rather than a widened token.
- **`vars.HUDDO_DEVOPS_GITHUB_APP_ID` stays a `vars` lookup.** In a called workflow
  `vars` resolves against the caller's repo/org, and this is an isw-kudos org
  variable already relied on by the release workflows here. An input default
  cannot reference `vars`, so an input would force every caller to repeat it.
- **Concurrency group now includes `inputs.image`.** The devops group was
  `<workflow>-<ref>`; two jobs in one caller file calling this workflow would have
  cancelled each other on PRs. `inputs` is available in `concurrency`.
- **Added `setup-qemu`, gated on `architecture != linux/amd64`.** The input
  existed upstream but non-amd64 values could not build without binfmt. Gated so
  the 20 existing amd64 callers gain no extra Docker Hub pull.
- Deferred: consumer PRs; removing `docker-build-generic.yml` from devops once
  all 20 callers are moved.
