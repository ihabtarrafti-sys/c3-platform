# Sprint 29A Closeout Report — Kit & Apparel Lifecycle Writes
**C3 Platform**
**Sprint:** 29A — Kit & Apparel Lifecycle Writes (first half of the S29 governed-writes split)
**Closeout date:** 2026-07-03
**Status:** CLOSED — hosted SP validation fully green (incl. per-role permission checks)
**Preceding sprint:** Sprint 28 CLOSED (Logistics Read Foundation)
**Validation baseline:** seven parity harnesses pass, tsc clean (incl. strict build path), verify:runtime PASS, hosted green

---

## Closeout statement

Sprint 29A closes as:

> **"C3 now writes mission kit and apparel operational truth. Operators (owner/operations)
> create kit assignments, walk them through a validated fulfillment lifecycle, and deactivate
> them with mandatory reasons; owner/operations/hr maintain apparel profiles. All writes run
> under the narrow ADR-013 Addendum — Mission Kit Logistics Exemption with three-layer
> authority (UI affordance → service validation → SharePoint ACLs), real ETag optimistic
> concurrency, compound-key row resolution, StatusNotes audit lines, SP version-history
> attribution, and list-level ACL hardening. The first C3 writes usable by non-owner roles
> are live and hosted-validated per role."**

Sprint 29A does **not** close as:

> ~~"A general write exemption exists (the addendum is explicitly narrow — membership,
> confirmation, finance, contracts, credentials remain governed/deferred)."~~
> ~~"Participant membership writes exist (Sprint 29B)."~~
> ~~"Kit metadata editing, reactivation UI, or physical deletion exist."~~
> ~~"Site-wide permissions were rewritten (two logistics lists only; site-level exposure
> documented as a separate owner decision)."~~

---

## What shipped

### Governance — ADR-013 Addendum: Mission Kit Logistics Exemption (`8f80ec2`)

Role matrix as approved and hosted-verified:

| Operation | Roles | Controls |
|---|---|---|
| AddKitAssignment | owner, operations | active-participant guard · compound duplicate pre-check + **unique deterministic Title constraint** (server-side race protection; display/constraint only — **never parsed**) · initial `KitStatus` always `NotOrdered` · immutable creation audit line |
| UpdateKitStatus | owner, operations | approved transition matrix (`utils/kitLifecycle.ts` — single source for UI menus, mock, SP, parity) · reasons mandatory into Returned/Missing/Replaced · audit line per transition |
| DeactivateKitAssignment | owner, operations | mandatory reason · `IsActive=false` · row retained (never deleted) |
| EditApparelProfile (upsert) | owner, operations, **hr** | create-if-absent; exact-active-row update; SP version history is the audit; user Notes never polluted |

### Write mechanics (`a06e041`)

- **Row resolution:** canonical compound columns only (`MissionID+PersonID+ItemCategory+AssignmentKey`; apparel by `PersonID`); 0 rows → RowNotFoundError; 2+ → DataIntegrityError (no write); never update-by-filter, never cached Id, never Title parsing.
- **Concurrency:** MERGE with the row's **actual ETag** (no `IF-MATCH: *` anywhere in the new writes); HTTP 412 → ConcurrencyError ("refresh and retry") — hosted-verified with a two-session drill; newer operator changes are never silently overwritten.
- **Audit:** `StatusNotes` append-only lines `[ISO] KITSTATUS <old>→<new> by <loginName> — <reason>`; SharePoint version history (retention 50) records the authenticated `Editor` per change — **actor identity comes exclusively from the authenticated AppContext loginName** (never form state), fail-closed on empty.
- **Failure surfacing:** every mutation toasts success and all failure classes (validation, duplicate, permission, concurrency, not-found, data-integrity, SP) — no silent failures, hosted-verified.

### UI (`53aae34`)

MissionWorkspace add/transition/deactivate with valid-targets-only menus and mandatory-reason
dialogs; PersonProfile apparel Add/Edit drawer. Read regressions unchanged.

### Security — list ACL hardening (`ad59226`, see `C3 Logistics List Permissions — Sprint 29A.md`)

Inheritance broken on the two logistics lists (before/after recorded by principal ID);
Operations=Edit (kit+apparel), HR=Edit (apparel), Legal/Members stripped of edit; owners/admin
preserved; site-level untouched. Hosted per-role checks passed: operations full kit lifecycle,
HR apparel-only, read-only roles denied writes.

### Schema delta (applied + REST-verified)

`StatusNotes` column; versioning 10→50 (kit+apparel); duplicate-Title audit clean;
`EnforceUniqueValues` on Title for kit, apparel, and participants (S29B prep).

---

## Commit summary

`8f80ec2` docs (exemption ADR + deltas) · `a06e041` feat (services) · `53aae34` feat (UI) ·
`e8b4e59` build (runtime; also fixed an unused import caught only by the strict build tsc —
the plain noEmit gate missed it) · `96366ee` docs (checkpoint) · `ad59226` docs (ACL
hardening record) · *(this commit)* docs closeout.

## Validation record

```text
s15 87/87 · s16 220/220 · s17 51/51 · s18 37/37 · s27 28/28 · s28 35/35
s29A kit lifecycle parity: 38/38 (compiled-from-source: full 8×8 matrix,
  reason rules, actor fail-close, audit format, key normalization,
  validators, 412/403/duplicate classification, mock behaviour parity)
tsc c3 + c3-spfx-host: clean (incl. strict build path)
beta:runtime / verify:runtime: PASS
runtime SHA-256: 0295b3f840489a1770f9ab208a09585ace6011629e2f6ebe2c51e28f66bc91d7
hosted SP validation: fully green (owner lifecycle, ETag concurrency drill,
  StatusNotes + version attribution, invalid transitions blocked, mandatory
  reasons, deactivation history retention, duplicate controls, apparel
  round-trip, Operations/HR/read-only role checks, core regression,
  no ErrorBoundary, no silent failures)
```

## Tech debt / deferred

- **TD-27 partially resolved:** kit + apparel writes complete; **participant membership
  writes remain** → Sprint 29B (full ADR-013 governance, locked).
- Open/unchanged: TD-26 (mission confirmation), site-wide permissions hardening (Members
  Edit / Legal FC on other lists), reactivation UI, kit metadata edits, top-500, CI/CD,
  TD-23.
- New Error Library entries ERR-023…ERR-029 for the S29A error classes.
