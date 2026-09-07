---
description: Comment the WHY, not the WHAT — no noise comments, no commented-out code, doc-comment only public/throwing/non-obvious functions.
scope: universal
source: [collab, votepol, boards, irt-flight-manager]
---

# Comment the WHY, not the WHAT

Self-documenting code first. Good names make most "what" comments redundant —
reach for a comment only when the code cannot explain its own intent.

## Comment intent, not mechanics

Explain *why* a decision was made, a non-obvious constraint, or a subtle edge
case — never restate what the code plainly does.

```ts
// ❌ Restates the code
// increment the counter by one
counter += 1;

// ✅ Explains a non-obvious reason
// Retry once: the upstream returns 503 on cold-start for ~2s after deploy.
await retryOnce(() => client.fetch(id));
```

## Do NOT write these comments

- On obvious code — if a name would make the comment redundant, fix the name.
- Change/fix history (`// fixed the bug where…`, `// changed to use X`) — that
  is what git blame and commit messages are for.
- Commented-out code. Delete it; git remembers it.
- Empty or aspirational `// TODO` with no owner or actionable detail.
- Section-divider decoration that adds no information.

## Doc-comments (TSDoc/JSDoc): only where they earn their place

Add a doc-comment only when a function is:

- **Exported / part of a public API** consumed outside its module, or
- **Throwing** — document what it throws and when (`@throws`), or
- **Non-obvious** — the parameters, return shape, or side effects are not clear
  from the signature.

Do not doc-comment small internal helpers whose signature already tells the
whole story.
