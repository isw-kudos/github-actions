---
description: Cross-module logic goes in a dedicated shared package; shared code is small, reusable, tested, and free of app-specific imports.
scope: universal
source: [collab, votepol, boards, irt-flight-manager]
---

# Shared code

When logic is needed by more than one app/module, extract it into a dedicated
shared package rather than copying it or importing across app boundaries.

## What belongs in a shared package

- Schemas / type definitions and their inferred types.
- Constants used by multiple consumers.
- Pure, side-effect-free utilities.
- Cross-service contracts (input/output shapes) — see below.

## Rules for shared code

- **Small and reusable.** If it's app-specific, it doesn't belong here. Shared
  code that only one app uses is just misplaced app code.
- **No app-specific imports.** A shared package must never import from an `apps/*`
  directory or depend on one app's runtime. Dependencies point *into* shared, never
  out of it.
- **No heavy/side-effectful dependencies** in a "types & pure utils" package
  (e.g. no SDK clients, no DB drivers) unless that is explicitly its purpose.
- **Ships with unit tests.** Any new code added to a shared package must include
  unit tests — shared code has the widest blast radius.
- **Consumed via the workspace**, referenced as a workspace dependency, not by
  reaching across directories with relative paths.

## Single source of truth

Define each shared type/rule **once** in the shared package and derive everything
else from it (inferred types, DB enums, client and server validators). Declaring
the same set of values in several places guarantees they drift apart and cause
real bugs. When a conversion/shape appears in two or more places, extract and
export a single named helper for it.
