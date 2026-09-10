# retag-images-ghcr: promote and roll back image tags with crane

## Context

`collab` (`retag-images.yml`, 14 images) and `boards` (`retag-images.yaml`, 9
images) move a deployment tag (`prod`, `cloud`, `*-last-working`) across every
image they deploy by calling the `retag-image` composite action in the private
`isw-kudos/devops` repo, frozen at `2d92d6c5`, once per image. That action does
`docker pull` / `docker tag` / `docker push`, which:

- downloads and re-uploads every layer of every image, sequentially, to move a
  tag;
- flattens the OCI index buildx pushes by default (provenance attestation,
  any extra platform) to the runner's platform and so changes its digest, so
  a promoted tag never has the digest of the tag it came from;
- stops at the first failure, leaving the target tag half promoted, with no
  preflight;
- expands `${{ inputs.* }}` straight into `run:` (gha-security §4).

Both consumer `renovate.json` files carry a "freeze" rule for the pin and a note
that the exit is to move the action here, where real tags are published.

Goal: one `retag-images-ghcr` component that takes the image list as an input
(no Huddo knowledge here), retags with `crane tag` in parallel after resolving
every source, and reports every failure plus a digest table in the job summary.

Out of scope: cross-registry copies (collab `release-on-quay.yml` stays as is;
a target-registry input would need a second credential set) and deleting the
devops action once both consumers have moved.

## Architecture

```
caller job (collab retag-images.yml / boards retag-images.yaml, kept as thin
            wrappers so the image list lives once per repo)
  uses: isw-kudos/github-actions/.github/workflows/retag-images-ghcr.yml@<sha> # retag-images-ghcr-vX.Y.Z
  with:    images (one per line), source_tag, target_tag
  permissions: packages: write
    │
    ▼
  retag  (ubuntu-latest, timeout 10m, permissions: packages: write,
          concurrency retag-images-ghcr-<owner>-<target_tag>, no cancel,
          CRANE_TIMEOUT=120 bounds every crane call)
    1. crane-installer (crane-release pinned, renovate-tracked)
       + docker/login-action ghcr.io with GITHUB_TOKEN
    2. Check sources    allowlist tags (OCI tag regex) and names (lowercase OCI
                        repository regex, one per line, no duplicates, CR
                        stripped), source != target;
                        crane digest <img>:<source> for every image in parallel,
                        plus what <target> points at now ("(none)" only on
                        MANIFEST_UNKNOWN / NAME_UNKNOWN; any other read failure
                        is fatal here, before a write);
                        any unresolved image -> fail, nothing written
    3. Retag            crane tag <img>@<source digest> <target> in parallel;
                        wait on each, collect failures; $GITHUB_STEP_SUMMARY
                        table image | source digest | target was |
                        updated/unchanged/failed; exit 1 if any failed
```

All inputs reach `run:` through `env:`; nothing from `${{ }}` is expanded in
shell.

## Key interfaces

`on.workflow_call` inputs:

| Input | Req | Notes |
|---|---|---|
| `images` | yes | Newline-separated names under `ghcr.io/<github.repository_owner>`. Blank lines ignored; two names on one line is an error. |
| `source_tag` | yes | Tag read on every image. |
| `target_tag` | yes | Tag written on every image. Must differ from `source_tag`. |

No `registry` or `namespace` input: auth is the caller's `GITHUB_TOKEN`, which
only works for ghcr.io under the caller's owner, and the name says so (same
convention as `docker-build-ghcr`). Package write access is still granted per
consuming repo, as before.

## Implementation Order

- [x] 1. `.github/workflows/retag-images-ghcr.yml` per the architecture above.
- [x] 2. Exercise both `run:` blocks locally against a stub `crane`: happy path
  (updated / unchanged / first-time target), missing source (no `tag` call
  made), invalid tags and names, empty list, one `tag` push denied (others
  proceed, run fails, summary marks the failure).
- [x] 2b. Adversarial review (separate agent) and fixes: bound each crane call
  with `timeout` so a stalled write still produces the summary; pin
  `crane-release` (the installer defaulted to `latest`, and its `verify: true`
  silently skips when `slsa-verifier` is absent, so that input is gone); tag by
  the resolved digest, not the source tag; fail the preflight on a non-404
  target read instead of recording `(none)`; reject duplicate names; strip CR.
- [x] 3. Component wiring: `releases/retag-images-ghcr/.releaserc.js`,
  `release-retag-images-ghcr.yml`, `renovate.json` scope rule,
  `check-component-scope.sh` case, docs tables (this repo's
  `per-component-versioning.md`, `CLAUDE.md`, `README.md`).
- [ ] 4. Merge as `feat(retag-images-ghcr): ...` → `retag-images-ghcr-v1.0.0`.
- [ ] 5. collab PR: `retag-images.yml` becomes a wrapper around this workflow
  (keeps its `workflow_dispatch` and the `sourceTag` / `targetTag` inputs so
  `promote-main-to-prod.yml` and `rollback-prod-to-last-working.yml` are
  untouched); trim the retag sentence from the devops freeze rule in
  `renovate.json`. Drafted alongside this PR with a placeholder pin.
- [ ] 6. boards PR: same for `retag-images.yaml`; its dedicated devops freeze
  rule for that file is deleted. Drafted alongside this PR with a placeholder pin.
- [ ] 7. Delete `.github/actions/retag-image` from devops once both are merged.

## Verification

```sh
zizmor --persona regular --offline .github/workflows/
pre-commit run --files .github/workflows/retag-images-ghcr.yml .github/workflows/release-retag-images-ghcr.yml renovate.json
# consumers, after the pin is real: dispatch "7. Util: Retag images" (collab)
# with sourceTag=main targetTag=<scratch tag>, check the job summary digests
# match `crane digest ghcr.io/isw-kudos/huddo-core:main`, then delete the tag.
```

## Notes / Deferred

- `crane tag`, not `crane copy`: same repository, so no layer existence checks;
  copy stays the tool for cross-registry (quay) moves.
- Always tag, even when the target already has the source digest: one code
  path, and it verifies write access uniformly; the summary says `unchanged`.
- crane binary signature verification is deferred: crane-installer only
  verifies when `slsa-verifier` is already on the runner, so it would need its
  own pinned installer step. The release is pinned instead.
- GitHub keeps one pending run per concurrency group and drops an older pending
  run when a newer arrives, so a run queued behind an in-flight one can vanish.
  Documented in the workflow header; inherent to Actions.
- Consumer wrappers rather than inlining the list in each caller job: the list
  would otherwise be copied three times per repo.
