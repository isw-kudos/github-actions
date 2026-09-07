# Progress — stefan-hattrell

## 2026-09-07
### Accomplished
- Audited `required-checks.yml` for draft-PR bypass. Verdict: safe today, but
  only because no listed check is draft-gated. Documented the invariant in the
  gate workflow, the `wait-for-required-checks` README, and as an exception in
  `.claude/rules/github-actions.md` (PR #16, draft, rebased on #17).
- Diagnosed the org-wide pre-commit failure: `pre-commit/action` nests
  `actions/cache@v4` by tag, which the repo's SHA-pinning policy rejects.
  Hand-rolled the three wrapper steps with SHA-pinned `actions/cache` v6.1.0, changed-range mode
  (PR #17, merged 2026-09-08).

### Decisions
- Kept `skipped` = pass in the gate rather than tightening it: renovate
  branches rely on it. Enforced the "listed checks must run on drafts" rule
  through documentation instead.
- Fix for pre-commit shipped as its own `ci/` PR rather than folded into #16,
  to keep PRs single-purpose.

### Next Steps
- Merge #17 first, then merge main into #16 so its pre-commit run re-fires.
- Admin: drop `pre-commit/action@*` from the repo allowed-actions patterns.
- Known edge, not fixed: on renovate branches pre-commit registers both a
  skipped PR-event run and a real push-event run on the same SHA; the gate
  picks the later `started_at`.
