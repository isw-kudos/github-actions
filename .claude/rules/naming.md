---
description: Naming conventions — language-neutral principles (descriptive, intent-based, consistent boundary casing) plus a casing-by-kind table for TypeScript/JavaScript; other languages follow their own idioms. Framework-specific naming lives in the stack modules.
scope: universal
source: [collab, votepol]
---

# Naming conventions

Names are the primary documentation. Prefer clear, descriptive names over
comments. The **principles** below are language-neutral; the **casing table** is the
convention for **TypeScript / JavaScript** (this repo's primary stack).

> **Other languages follow their own idioms — don't apply this table to them.**
> e.g. Python uses `snake_case` for functions, variables, and modules/files and
> `PascalCase` for classes; Go uses exported `PascalCase` / unexported `camelCase`.
> Match the language's established style over the table below.

Casing by kind (TypeScript / JavaScript):

| Thing                         | Convention        | Example                    |
| ----------------------------- | ----------------- | -------------------------- |
| Variables & functions         | `camelCase`       | `resourceCount`, `getUser` |
| Types, interfaces, classes    | `PascalCase`      | `ResourceRecord`, `ApiError` |
| Constants (fixed, module-top) | `UPPER_SNAKE_CASE`| `MAX_PAGE_SIZE`            |
| Files (default)               | `kebab-case`      | `resource-service.ts`      |
| Enum members                  | `UPPER_SNAKE_CASE`| `Status.IN_PROGRESS`       |
| Booleans                      | `is`/`has`/`can` prefix | `isActive`, `hasAccess` |
| Event-handler params          | `on` prefix       | `onSelect`, `onSubmit`     |

## Principles

- **Descriptive over terse.** `elapsedMs` beats `t`. Avoid single-letter names
  outside tight loops.
- **Consistent boundary casing.** Pick one casing per boundary and map at the
  edge (e.g. `snake_case` DB columns ↔ `camelCase` in code) rather than leaking
  one convention into the other.
- **No abbreviations that aren't universal.** `config` is fine; `cfgMgr` is not.
- **Name for intent, not type.** `users`, not `userArray`.

## Framework-specific naming lives in the stack modules

Conventions tied to a framework or tool — React component/hook/props naming,
generated-file names, ORM column mapping, route-file conventions — are defined in
the relevant `stack-*` module, not here. This rule is the language-neutral base;
a stack module may extend or override it for files it owns.
