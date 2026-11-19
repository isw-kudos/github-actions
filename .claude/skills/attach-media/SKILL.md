---
name: attach-media
description: Use when a GitHub pull request, issue, or comment should show a screenshot, image, GIF, or video (before/after shots, a UI change, a bug repro, a diagram). Uploads it with gh's --attach so GitHub hosts it like a drag-and-drop in the web UI, with no image committed to the repo and no external host.
allowed-tools: Bash(gh --version), Bash(gh pr create *), Bash(gh pr edit *), Bash(gh pr comment *), Bash(gh issue create *), Bash(gh issue edit *), Bash(gh issue comment *)
---

# Attach media to a PR, issue, or comment

`gh` v2.99+ uploads local files to GitHub's own attachment storage, the same as
dragging an image into the web UI. Use it whenever a screenshot or video would help
a reviewer. A UI change should almost always show one (the `browser-verify` skill
takes them).

## Never host images elsewhere

- ❌ Commit screenshots to the repo, or to a side branch, just to link them.
- ❌ Upload to a gist, an image host, a bucket, or a personal repo.
- ✅ `--attach`. GitHub stores the file with the PR, issue, or comment, and it
  gets the repository's visibility.

## Check `gh` first

```sh
gh --version    # needs 2.99.0 or later
```

If it is older, ask the user to update `gh`. Don't fall back to another host.
`--attach` doesn't work on GitHub Enterprise Server yet. It needs write access to the
repo and the `gh auth login` OAuth token (or a classic PAT). If an upload fails
under `GITHUB_TOKEN` or a fine-grained token, say so and ask the user to run
`gh auth login`.

## Reference each file in the body AND pass it with `--attach`

Write the image where it belongs in the body as a normal Markdown image with a
local path, and pass the same file with `--attach`. `gh` uploads it and rewrites
the path to the uploaded URL. An attached file the body doesn't mention is appended
at the end.

```sh
gh pr create --draft --title "fix(ui): keep the save button visible" \
  --body-file pr-body.md \
  --attach ./shots/before.png --attach ./shots/after.png
```

```markdown
## Testing

| Before | After |
| --- | --- |
| ![Save button hidden under the footer](./shots/before.png) | ![Save button above the footer](./shots/after.png) |
```

- ❌ `![after](./shots/after.png)` in the body with no `--attach ./shots/after.png`.
  The PR shows a broken image with a local path.
- ✅ Every image in the body has a matching `--attach`.

**Paths in a `--body-file` are resolved from that file's folder**, falling back to
the working directory. If the body file is in a temp or scratch folder, use
absolute paths in both places, or save the images next to the body file.

## Alt text

Describe what the image shows, not its filename. Write it in the body
(`![Save button above the footer](./after.png)`), or after `#` for an appended file:
`--attach './after.png#Save button above the footer'`. Alt text written in the body
wins. Video has no alt text, so describe the video in the text next to it.

## Edits and comments

```sh
gh pr edit 42 --attach ./shots/after.png                       # appends to the current body
gh pr edit 42 --body-file pr-body.md --attach ./shots/after.png  # REPLACES the body
gh pr comment 42 --body "Fixed on mobile too:" --attach ./shots/mobile.png
```

`gh pr edit` with a body flag replaces the whole description. To insert an image
into an existing body, fetch it first (`gh pr view 42 --json body -q .body`), add the
reference, and send the full body back with `--attach`.

The same flags work on `gh issue create`, `gh issue edit`, and `gh issue comment`.

## When an upload fails

If some files fail, `gh` still creates or updates the PR with the ones that worked,
prints its URL, and exits non-zero.

- ❌ Run `gh pr create` again. That opens a second PR.
- ✅ Read the URL from the output and add the missing files with
  `gh pr edit <number> --attach <file>`.

## Limits and safety

- Types: PNG, JPEG, GIF, WebP, SVG, MP4, MOV, WebM.
- Images and GIFs up to 10 MB. Video up to 10 MB on free plans, 100 MB on paid plans.
- Up to 50 files per command.
- Look at each screenshot before uploading it. Crop out or blur tokens, keys,
  customer or personal data, and unrelated windows. Anyone who can see the repo can
  open the file, and deleting the PR text doesn't delete the upload.
