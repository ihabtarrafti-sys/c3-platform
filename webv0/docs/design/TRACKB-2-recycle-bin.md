# Track B2 — Recycle Bin (cross-domain restore register)

**Status: BUILDING.** Second Track B item. Owner design (2026-07-10):
"one cross-domain register of everything inactive/removed, with provenance
from the audit trail + per-domain Restore matching each domain's governance
class… the no-DELETE law means the data half already exists — this is a door,
not a data change. Kills the what-if-I-break-something fear."

## The load-bearing principle

**The recycle bin restores through each domain's OWN governance class — never
a backdoor.** A person was deactivated through the governed pipeline, so
restoring one SUBMITS a `ReactivatePerson` approval an owner must execute.
Entities and teams were deactivated directly-audited, so they restore
immediately. The bin never grants a shortcut the domain itself wouldn't.

## v1 scope — the whole-record soft-deletes (6 domains)

The register gathers every `is_active = false` record across the domains
where "I removed a whole thing by mistake" is the real fear, each row uniform:
`{ kind, id, label, sublabel, parentId, removedAt, removedBy, version,
restoreClass }`. Provenance (`removedBy`, `removedAt`) is the latest
`audit_event` for that entity — since the record is currently inactive, its
latest event IS the removal, by construction.

| kind | inactive marker | restoreClass | restore path |
|------|-----------------|--------------|--------------|
| person | is_active=false | **governed** | `submitReactivatePerson` (approval; reason required) |
| entity | is_active=false | **direct** | `reactivateEntity` (version-guarded) |
| team | is_active=false | **direct** | `reactivateTeam` (version-guarded) |
| credential | is_active=false | recordPage | opens the owning person's profile |
| kit | is_active=false | recordPage | opens /kit |
| apparel | is_active=false | recordPage | opens /apparel |

**Read gate:** owner/operations (`canManageEntities`) — lifecycle management
is their console; the restore endpoints re-assert their own class-specific
gate underneath.

## Deliberately out of v1 (honest boundaries, matching the plan)

- **Terminal financial states** — Terminated agreements, Cancelled journeys,
  Retired beneficiaries, Revoked distributions, Voided invoices — are
  **v2 governed Reinstate with a mandatory reason** (the plan says so;
  Reinstate must record BOTH events, never falsify history). Not shown yet.
- **Sub-records** — team memberships, mission participants, mission lines,
  agreement terms — removal is visible + restorable ON THEIR PARENT'S PAGE,
  with the context (role, etc.) a flat bin can't give. Not duplicated here.
- **Documents** — audit under their OWNER's id, not a doc id, so provenance
  doesn't cleanly key; visible on the parent record. Deferred.
- **Members (app_user)** — member lifecycle has its own Members surface +
  cross-tenant (shared-user) nuance. Out.

## Signals law

The recycle bin is a passive SAFETY NET, not a source of obligations — a
removed record is not a to-do. So it ships **no new cockpit check** (the law
is satisfied vacuously: nothing here is "wrong" or awaiting action). Recorded
so the omission is deliberate, not forgotten.

## Mechanics

- `recycleSql.ts` — one UNION ALL over the 6 domains (the searchSql pattern),
  each branch a `WHERE is_active = false` projection + a correlated
  `audit_event` subquery for provenance; ORDER BY removed_at DESC. RLS applies
  to every branch and to audit_event.
- `recycleBinOps.ts` — `listRecycleBin` (gated) and `restoreRecord` (dispatch
  by kind to the domain's real reactivate; person → approval, entity/team →
  direct; other kinds → 400 "restore from its record").
- API: `GET /api/v1/recycle-bin`, `POST /api/v1/recycle-bin/restore`
  `{ kind, id, expectedVersion, reason? }` → `{ outcome: 'restored' |
  'approval-submitted', … }`.
- Web: `RecycleBinPage` (register + kind chips + Restore / Open-record per
  row; person Restore collects the mandatory reason), nav entry (owner/ops).
