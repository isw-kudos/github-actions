# move-branch-tag

Points a branch tag (`main`, `dev`) on ghcr.io at the image a build just pushed, but only when that keeps the tag on the newest commit of the branch. It is part of the `docker-build-ghcr` component (released with its `docker-build-ghcr-v*` tags). `docker-build-ghcr.yml` calls it with `uses: $/.github/actions/move-branch-tag` when `forward_only_branch_tag` is on, so the action always runs from the same commit as the workflow. `$/` needs runner 2.336.0 or later.

## Why

A caller that builds every push (one concurrency group per commit) can build one image for consecutive commits at the same time. Without this action the build that finishes last owns the branch tag, even when it built the older commit.

## What it reads

- **Tag commit:** the `org.opencontainers.image.revision` label of the image the tag points at (`docker buildx imagetools inspect --format '{{json .}}'`). Every docker-build-ghcr build carries it. A multi-platform image is read from its first platform; all platforms carry the same label.
- **Tag digest:** from the same call.
- **Branch head:** `GET /repos/{repo}/git/ref/heads/{branch}`.
- **Compare status:** `GET /repos/{repo}/compare/{tag commit}...{this commit}`, only when neither commit is the branch head.

## Decision

| State | Action |
|---|---|
| this commit is the branch head (also after a reset to an older commit) | move |
| tag does not exist, or its image has no revision label | move |
| tag holds this commit, same digest | keep |
| tag holds this commit, other digest (a re-run of the commit) | move |
| tag holds the branch head | leave, `::notice::` |
| compare `ahead`, or 404 (the tag's commit is not in the repository) | move |
| compare `identical` | keep |
| compare `behind`, or `diverged` (this commit left the branch) | leave, `::notice::` |
| any other compare status | fail |

A move is `docker buildx imagetools create --prefer-index=false --tag <branch tag> <image>@<digest>`: the tag is re-pointed at the pushed manifest with the same digest, and nothing is rebuilt.

## Race

ghcr.io has no compare-and-set on a tag. An older build that read the tag before this build's write can still write after it, within its own check-to-write time (a few registry and API calls, normally 1-3 s). So after each move the action waits `settle-seconds` (20), reads the tag again, and moves it back if an older build wrote it. The older build's own second read then sees the newer commit and leaves it. After `max-moves` (3) moves with the tag still older, the step fails.

An older build can still win only if its check-to-write takes longer than `settle-seconds`. Each move adds `settle-seconds` to the job.

## Errors

Registry errors other than "not found", GitHub 5xx and rate limits (429, or 403 with no requests left) are retried twice, after 5 s and 10 s. Any other failure fails the step with an `::error::`; by then the `sha-<commit>` image is already pushed.

## Inputs

See [`action.yml`](action.yml). The token needs `contents: read` on the calling repository; docker-build-ghcr's job already holds it. The registry calls use the job's `docker login`.

## Tests

```bash
node --test .github/actions/move-branch-tag/index.test.cjs
```

The pre-commit hook `move-branch-tag-tests` runs them. They run the decision table, the retry rules, the input checks, the API and `imagetools` call shapes against fakes, and two builds at once on one tag in the order that loses without the settle.
