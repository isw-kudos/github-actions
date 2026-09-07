---
description: YAGNI bias — climb the decision ladder before writing code, prefer the smallest diff, never simplify away safety.
scope: universal
tags: [yagni, minimalism, simplicity, dependencies]
source: [ponytail (DietrichGebert/ponytail, MIT — concept)]
---

# Write the minimum that works

This rule biases toward the minimal solution. It targets **over-building** —
unnecessary code, premature abstraction, needless dependencies; on already-minimal
work it's simply a no-op. The safety carve-outs below are **non-negotiable**: never
simplify them away, or the bias flips to **under-building**. (For a dedicated,
on-demand complexity pass over a diff, the `/review-complexity` skill is a separate
opt-in.)

> The best code is the code you never wrote.

## Understand before you optimize

Comprehend the problem first. Laziness that skips understanding to ship a small
diff is the dangerous kind — a wrong 3-line change is worse than a right 30-line
one. Get the behaviour right, then make it small.

## The decision ladder

Before writing new code, climb this ladder and **stop at the first rung that
holds**:

1. **Does this need to exist at all?** If the requirement can be met without it,
   skip it. The cheapest code is deleted code.
2. **Reuse existing code** in the codebase — a function, util, or component that
   already does this (or almost does).
3. **Use the standard library** of the language/runtime.
4. **Use native platform features** — e.g. reach for the built-in before adding a
   library that wraps it.
5. **Use an already-installed dependency** rather than adding a new one.
6. **Write it as one line** (or a handful) inline.
7. **Only then** write the minimum implementation that actually works.

Adding a new dependency is a rung 5+ decision, not a reflex: a new package is
supply-chain surface, upgrade burden, and bundle weight forever.

### Example: a date input

```html
<!-- ❌ install a date-picker lib + a wrapper component + a stylesheet -->
<DatePicker value={value} onChange={setValue} theme={customTheme} />

<!-- ✅ the platform already ships one -->
<input type="date" value={value} onChange={(e) => setValue(e.target.value)} />
```

```ts
// ❌ add a utility library for a one-liner
import groupBy from "some-lodash-clone";
const byKey = groupBy(items, (i) => i.key);

// ✅ stdlib already does this
const byKey = Map.groupBy(items, (i) => i.key);
```

## Prefer the smallest diff

- Change the fewest lines that solve the problem. Don't refactor surrounding code
  "while you're here" unless asked.
- Don't add a layer of indirection (interface, factory, config option, generic)
  for a single caller. Abstract on the **third** repetition, not the first.
- Don't add configuration, flags, or extensibility hooks nobody requested.
- Delete code that the change makes dead. Fewer moving parts, fewer bugs.

## HARD SAFETY CARVE-OUTS — never simplify these away

Minimalism stops at safety. These are non-negotiable; **never** cut them in the
name of a smaller diff:

- **Input validation at trust boundaries** — request bodies, query params,
  external/API responses, file/CLI input, anything crossing from untrusted to
  trusted.
- **Error handling that prevents data loss or corruption** — transactions,
  rollbacks, retries where correctness depends on them, cleanup of partial writes.
- **Security measures** — authn/authz checks, escaping/encoding, secret handling,
  CSRF/injection defences.
- **Accessibility basics** — labels, semantic elements, keyboard access, focus.
- **Anything the user explicitly requested** — even if it looks like more code
  than the task "needs". Their requirement wins.

A smaller diff that drops any of the above is not minimal, it's broken. When in
doubt, keep the safeguard.

---

Concept credit: distilled from the "ponytail" skill by DietrichGebert
(github.com/DietrichGebert/ponytail, MIT). This is an ISW-authored rule inspired
by that concept — not a copy of the plugin, its hooks, or its statusline.
