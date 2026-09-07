---
description: Validate at the boundary and fail early; allowlists over blocklists; parameterised queries only; typed errors for business rules; client validation is UX-only.
scope: universal
source: [collab, votepol, boards]
---

# Validate at the boundary

Validate every incoming request/message the moment it enters the system, before
any business logic runs. Reject bad input immediately with a typed error.

```ts
// ✅ parse & narrow at the handler boundary
const input = zCreateResource.parse(request.body); // throws on bad shape
```

Constrain simple types tightly at the boundary: emails, UUIDs, integer ranges,
string min/max, enums — don't accept "any string" when you mean "one of three".

## Allowlists over blocklists

Define what is *valid*, not what is *bad*. Blocklists always miss a case.

```ts
// ✅ allowlist — enumerate what's permitted
const zRelationshipType = z.enum(["COMPATIBLE_WITH", "SIMILAR_TO", "PART_OF"]);

// ❌ blocklist — trying to reject bad values
if (type === "hack" || type === "drop") reject();
```

## Parameterised queries only — never interpolate input

Never build a query by string-concatenating or interpolating user input. Use the
driver/ORM's parameter binding every time. This is non-negotiable.

```ts
// ❌ db.query(`SELECT * FROM t WHERE id = '${id}'`)
// ✅ db.query("SELECT * FROM t WHERE id = $1", [id]);
```

## Throw typed errors for business-rule violations

When a request is well-formed but breaks a business rule, throw a typed error —
don't accumulate error strings or return an ad-hoc `{ ok: false }`.

```ts
if (resource.ownerId !== actorId) throw new ForbiddenError(resource.id);
```

## One source of truth for validation shapes

Define each type/constraint once (e.g. a single schema) and reuse it for both
client and server validation and to infer types. Redeclaring the same rules in
several places guarantees they drift apart. See `shared-code.md`.

## Client-side validation is UX-only

Client/frontend validation exists to give fast feedback. It is **not** a
security or correctness boundary. The server re-validates everything — all
sanitisation and business rules are enforced server-side. Client-only gating is
a bug, not a feature.
