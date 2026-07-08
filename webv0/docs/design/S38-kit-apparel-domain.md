# Sprint 38 — Kit & Apparel Domains (Design & Increment Plan)

**Author:** Architect-of-record · **Date:** 2026-07-08 · **Goal:** the equipment domains — two entity types in one sprint, because they introduce **zero new patterns**: both are pure **direct-but-audited** CRUD (Sprint 37's second mutation pattern), matching the certified CP posture where kit/apparel were operational "exempt-edit" flows, never approval-gated. The optimistic version guard plays the role the SP-era ETag/412 discipline played.
**Claims discipline:** nothing publicly claimable until hosted-certified and worded by the truthfulness authority.

## Entities

**Kit** — `KIT-XXXX`: equipment items (peripherals, hardware, gear).
**Apparel** — `APL-XXXX`: team clothing items.

Shared shape (each in its own table):

| Field | Type | Rules |
|---|---|---|
| name | text, required ≤160 | e.g. "Tournament headset #3" / "Away jersey L" |
| category | text, required ≤120 | free-text category (Kit: "Peripheral"; Apparel: "Jersey") |
| size | text, optional ≤40 | apparel-meaningful; kept on both for symmetry (kit: n/a → null) |
| assignedPersonId | PER-XXXX, optional | nullable composite FK — an item may be unassigned |
| notes | optional ≤2000 | |
| isActive | boolean | direct-audited deactivation (retired items stay retired; reactivation = roadmap, CP parity) |
| version | int | the optimistic-concurrency token (ETag-parity) |

## Operations — all DIRECT-BUT-AUDITED (no approvals)

Create · Update (field edits + assign/unassign, version-guarded, **before/after images audited**) · Deactivate (version-guarded). Every mutation writes its audit event in the same transaction. `OPERATION_TYPES` is **unchanged** — nothing here enters the approval pipeline.

Audit actions: `KitCreated` `KitUpdated` `KitDeactivated` `ApparelCreated` `ApparelUpdated` `ApparelDeactivated`.

## Authorization (CP-parity nuance preserved)

- `canManageKit`: **owner, operations**.
- `canManageApparel`: **owner, operations, hr** — the certified CP ACL gave HR edit rights on Apparel (team clothing is HR-adjacent); this is the first capability where `hr` is not read-only, and it is deliberate.
- Reads: people-adjacent (`canReadPeople`, every authenticated role).

## Read surfaces (K4)

Two registers (id, name, category, size, assigned person link, Active/Inactive badge) with create/edit/deactivate dialogs (GovernedAction confirmations, honest immediacy copy). Person-profile equipment sections = deferred follow-up (register person-links suffice for V1).

## Increments

- **K1 — domain**: both entities, `KIT-`/`APL-` id kinds, create/update input schemas (update = partial patch of editable fields), audit actions, capabilities, labels. Tests.
- **K2 — persistence + application**: migration 0011 (both tables, RLS FORCE, optional person FK, counter kinds), writeTx insert/update/deactivate ×2 (drizzle-only), direct use-cases with authz + version guard + same-tx audit, export/exit table-set extension. Tests incl. stale-version and hr-on-apparel-but-not-kit.
- **K3 — API**: registers + create/update/deactivate routes (versioned bodies). HTTP tests incl. the 409 stale case and the hr role split.
- **K4 — web + deploy**: registers + dialogs + nav, E2E; staging deploy (0011 paste → API → web) + hosted smoke.

Same cadence as Sprints 35–37.
