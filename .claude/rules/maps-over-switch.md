---
description: Prefer a lookup map (Record) with a fallback over a switch on strings; keep switch only for exhaustive discriminated unions or complex per-branch logic.
scope: universal
source: [collab]
---

# Prefer lookup maps over `switch` on strings

When branching on a string value, prefer a lookup map + fallback over a `switch`.
Maps are shorter, data-driven, and trivial to extend.

Use a map when the branch is on a string and any of these hold:

- there are **3+ cases**,
- multiple cases **share a return value** (fallthrough), or
- the set of cases is **likely to grow**.

```ts
// ❌ switch on a string with shared returns and a growing set
switch (state?.toLowerCase()) {
  case "open":
  case "active":
    return "badge--open";
  case "archived":
    return "badge--archived";
  default:
    return "badge--default";
}

// ✅ lookup map + fallback
const STATUS_CLASS: Record<string, string> = {
  open: "badge--open",
  active: "badge--open",
  archived: "badge--archived",
};
return STATUS_CLASS[state?.toLowerCase() ?? ""] ?? "badge--default";
```

## Keep `switch` for these cases

- **Exhaustive discriminated unions** where you want the compiler to force a case
  for every variant. Add an exhaustiveness guard in `default`:

  ```ts
  switch (event.type) {
    case "created": return handleCreated(event);
    case "deleted": return handleDeleted(event);
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
  ```

- **Complex per-branch logic** — when each case runs several distinct statements
  rather than mapping an input to a value.
