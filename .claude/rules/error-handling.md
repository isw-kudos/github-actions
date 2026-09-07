---
description: Only throw Error subclasses; use typed error classes carrying context; handle at a single boundary; generic user-facing messages; backoff on transient failures.
scope: universal
source: [collab, votepol]
---

# Error handling

## Only throw Error subclasses — never strings or objects

```ts
// ❌ throw "not found";  throw { code: 404 };
// ✅
throw new ResourceNotFoundError(id);
```

## Define typed error classes that carry context

Give each domain failure its own class, set `name`, and attach the data a caller
or logger needs. Never lose the context that makes the error diagnosable.

```ts
export class ResourceNotFoundError extends Error {
  constructor(public readonly resourceId: string) {
    super(`Resource not found: ${resourceId}`);
    this.name = "ResourceNotFoundError";
  }
}
```

## Handle at a single boundary — don't scatter or swallow

- Catch and translate errors at **one** boundary (e.g. the framework's central
  error hook / a top-level handler), not with try/catch sprinkled through the
  call stack.
- Never swallow an error silently. If a failure is genuinely non-critical
  (analytics, metrics), catch-and-warn — log it, don't hide it.
- Let typed errors propagate to the boundary that knows how to map them.

## User-facing messages are generic

Return a generic message to clients. Never leak internals, stack traces, SQL, or
implementation details across the boundary. Log the full error internally.

```ts
// boundary: map typed error -> generic response
if (err instanceof ResourceNotFoundError) return respond(404, "Not found");
return respond(500, "Something went wrong"); // never err.stack
```

## Clean up with try/finally

Release resources (connections, locks, file handles) in `finally` so they are
freed on both the success and failure paths.

## Retry transient external failures with exponential backoff

For flaky external services (network, third-party API), retry with exponential
backoff and a cap. Do **not** retry deterministic failures (validation, 4xx).

## Classify errors with a code-prefix taxonomy

Give errors stable, greppable codes prefixed by domain so clients and logs can
branch without string-matching messages:

```
AUTH_*        authentication / session
VALIDATION_*  request shape / business-rule violations
NOT_FOUND_*   missing resource
CONFLICT_*    concurrent-edit / uniqueness
INTERNAL_*    unexpected server fault
```
