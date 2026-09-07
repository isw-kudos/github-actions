---
description: Maintain a per-developer session log at docs/progress/<git-user>.md — condense the previous detailed entry to 1-2 sentences, then add a new dated detailed entry (Accomplished / Decisions / Next Steps). Durable cross-session memory, one file per developer so parallel work never conflicts.
scope: meta
source: [votepol]
tags: [docs, process, memory]
---

# Keep a progress log

Maintain a running session log as durable cross-session memory: the next session
reads it to know where things stand without re-deriving context.

## One file per developer — never a single shared log

Write to **`docs/progress/<git-user>.md`**, where `<git-user>` is the current git
user (slugified), so parallel work never collides:

```sh
# lowercase, collapse any run of non-alphanumerics to a single "-", trim ends
git config user.name | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-*//;s/-*$//'
# "Nicky Tope" → nicky-tope   →   docs/progress/nicky-tope.md
```

A single shared `PROJECT_PROGRESS.md` conflicts on every parallel branch — one file
per developer avoids that entirely. Each file is that developer's own log; to see
overall status, read the directory. (An agent uses the git user of the checkout it's
working in.)

## The update pattern (end of every session)

1. **Condense the previous detailed entry** in your file down to 1-2 sentences —
   keep the headline, drop the detail.
2. **Add a new detailed entry** at the top with today's date/time and these
   subsections:
   - **Accomplished** — what actually got done this session.
   - **Decisions** — choices made and why (especially anything non-obvious or that
     changes direction).
   - **Next Steps** — the concrete next actions for whoever picks this up.
3. Always include the **date** on each entry.

The result is a stack of short historical summaries plus **one rich current entry** —
full recent context without the file growing without bound.

## Example shape (`docs/progress/nicky-tope.md`)

```md
# Progress — nicky-tope

## 2026-07-02
### Accomplished
- Added CSV export endpoint + schema; wired the download button.
### Decisions
- Stream the export rather than buffer — files can exceed request memory limits.
### Next Steps
- Add the e2e smoke test; handle the empty-result case.

## 2026-07-01
Set up the export service skeleton and the shared row-mapper.  <!-- condensed -->

## 2026-06-30
Scaffolded the reporting package and its config.  <!-- condensed -->
```

Keep it factual and short. This is memory, not a changelog for release notes.
