# move-branch-tag

Points a branch tag (`main`, `dev`) on ghcr.io at the image a build just pushed, but only when that keeps the tag on the newest commit of the branch. It is part of the `docker-build-ghcr` component (released with its `docker-build-ghcr-v*` tags). `docker-build-ghcr.yml` calls it with `uses: $/.github/actions/move-branch-tag` when `forward_only_branch_tag` is on, so the action always runs from the same commit as the workflow. `$/` needs runner 2.336.0 or later.

## Why

A caller that builds every push (one concurrency group per commit) can build one image for consecutive commits at the same time. Without this action the build that finishes last owns the branch tag, even when it built the older commit.

## What it reads

- **Tag commit and digest:** the `org.opencontainers.image.revision` label and digest of the image the tag points at (`docker buildx imagetools inspect --format '{{json .}}'`). Every docker-build-ghcr build carries the label. A multi-platform image is read from its first platform; all platforms carry the same label.
- **Branch head:** `GET /repos/{repo}/git/ref/heads/{branch}`.
- **Compare status:** `GET /repos/{repo}/compare/{base}...{head}`, the status of `head` relative to `base`. A commit is "on the branch" when `{commit}...{branch head}` is `ahead` or `identical`. Compare calls are made only when the first rows below do not decide.

## Decision

The first row that matches decides:

| State | Action |
|---|---|
| tag holds this commit with this digest | keep |
| tag holds this commit with another digest, before this build moved the tag (a re-run replaces the earlier build) | move |
| tag holds this commit with another digest, after this build moved the tag (another caller workflow built the same commit at the same time; the later one keeps it) | keep |
| this commit is the branch head (also after a reset to an older commit) | move |
| tag does not exist, or its image has no revision label | move |
| tag holds the branch head | leave |
| branch head cannot be read: compare `{tag commit}...{this}` is `ahead` or 404 / `identical` / `behind` or `diverged` | move / keep / leave |
| this commit is not on the branch (it was amended or force-pushed away) | leave |
| compare `{tag commit}...{this}`: `ahead`, `diverged` (the tag's commit left the branch), or 404 (not in the repository) | move |
| compare: `identical` | keep |
| compare: `behind`, and the tag's commit is on the branch | leave |
| compare: `behind`, and the tag's commit left the branch | move |
| any other compare status | fail |

A move is `docker buildx imagetools create --prefer-index=false --tag <branch tag> <image>@<digest>`: the tag is re-pointed at the pushed manifest with the same digest, and nothing is rebuilt. Each "leave" logs a `::notice::` with the reason.

## Race

ghcr.io has no compare-and-set on a tag. An older build that read the tag before this build's write can still write after it, within its own check-to-write time. Three rules keep that time well under `settle-seconds` (20):

- After each move the action waits `settle-seconds`, reads the tag again, and moves it back if an older build wrote it. The older build's own second read then sees the newer commit and leaves it.
- A pass whose read-and-decide took longer than half of `settle-seconds` writes nothing and starts again with a fresh read.
- A transient failure restarts the whole pass with a fresh read instead of retrying one call on an old decision. A failed write may still have landed, so it counts as a move and gets the full settle.

An older build can still win only if its write takes longer than half of `settle-seconds` to land after a fresh decision (each registry and API call times out after 30 s). After `max-moves` (3) moves that were each undone, the step fails. Each move adds `settle-seconds` to the job.

## Errors

Registry errors other than "not found" for the tag itself, GitHub 5xx and rate limits (429, or 403 with no requests left or with `retry-after`), and stale decisions restart the pass, at most twice, after 5 s and then 10 s. A missing child manifest or blob of an existing tag is an error, not a missing tag. Any other failure fails the step with an `::error::`; by then the `sha-<commit>` image is already pushed.

## Inputs

See [`action.yml`](action.yml). The token needs `contents: read` on the calling repository; docker-build-ghcr's job already holds it. The registry calls use the job's `docker login`.

## Tests

```bash
node --test .github/actions/move-branch-tag/index.test.cjs
```

The pre-commit hook `move-branch-tag-tests` runs them. They run the decision table against a small commit graph (including amended and force-pushed commits), the restart and freshness rules, the input checks, the API and `imagetools` call shapes against fakes, and two builds at once on one tag in each race order: the older write moved back, a slow older decision that reads again, and the documented limit.
