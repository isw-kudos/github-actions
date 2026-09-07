---
description: Never read env vars in handlers/components; isolate to a config module that parses & validates at startup (fail fast); commit a .env.example; build-time public vars use full literal names.
scope: universal
source: [collab, votepol, boards, irt-flight-manager]
---

# Environment configuration

## Never read env vars in handlers, components, or business logic

Do not touch `process.env` (or the platform equivalent) scattered across the
codebase. Access configuration only through a typed config module.

```ts
// ❌ in a request handler / component
const url = process.env.API_URL;

// ✅ isolate to a config module
import { config } from "@/config";
const url = config.apiUrl;
```

## Parse & validate config at the boundary — fail fast

The config module reads the raw environment **once** at startup, validates it
against a schema, and exports a typed, frozen object. Validation must throw on
bad/missing config so the process crashes at startup — never fall back to silent
defaults that surface as a mysterious runtime bug later.

```ts
// config.ts — parse, don't safe-parse. Crash loudly on bad config.
const env = zEnv.parse(process.env);   // ✅ throws at startup
// ❌ const env = zEnv.safeParse(...)   // swallows bad config
export const config = Object.freeze({ apiUrl: env.API_URL, ... });
```

Use coercion for string-typed inputs (ports, flags) so numbers and booleans are
real numbers and booleans downstream.

## Commit a `.env.example` documenting every variable

Keep a committed `.env.example` listing every variable the app reads, with a
one-line comment on each explaining its purpose and format. Real `.env` files
(and `.env.local`) stay gitignored and out of the agent's reach. Shared
non-secret dev defaults may live in a committed `.env.development`; personal and
secret values go in a gitignored `.env.local`.

## Build-time public vars: full literal names, no aliases

Vars inlined at build time by the bundler (e.g. `NEXT_PUBLIC_*`, `VITE_*`) are
statically replaced by exact string match. Always write the full literal name at
the point of use — never alias or compute it — or the replacement silently
fails. Use un-prefixed server vars for anything that must be runtime-configurable
and pass it in as needed.

## Prefer presence-based mode switches with a prod guard

When config selects a mode (e.g. local emulator vs cloud), switch on the
*presence* of a variable rather than a mode flag, and add a guard that rejects
unsafe combinations in production (e.g. refuse static credentials when the
runtime should use an injected identity).
