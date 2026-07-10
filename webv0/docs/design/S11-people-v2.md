# S11 — People v2: the PIF field model, the PII tier, editability, deactivation

**Status: IN BUILD. Migration 0032. Spec ratified by owner 2026-07-10
(C1: PII = owner/operations/hr · C2: identity-material governed /
operational direct-audited / deactivation governed).**

## Why

The person record today is the Sprint-34 skeleton (fullName + a few
operational strings) and is **immutable after creation** — the biggest gap
in the register. The owner's real Personal Information Form (PIF) defines
what a person actually is; S11 makes the record match it and makes it
maintainable under the same laws as everything else.

## Field model v2

| Group | Fields | Read | Write |
|---|---|---|---|
| Identity-material | firstName, lastName, dateOfBirth*, nationality, otherNationalities[] | dateOfBirth is PII | **GOVERNED** (`UpdatePersonIdentity` pipeline op) |
| PII contact block | addressLine1/2, addressCity, addressCountry, phone, email | **PII tier** | direct-audited (contacts are operational per C2) |
| Operational | position, dateOfJoining, currentTeam, currentGameTitle, primaryDepartment, primaryRole, personnelCode, ign, notes | everyone | direct-audited (`PersonOperationalUpdated`) |
| Lifecycle | isActive | everyone | **GOVERNED** (`DeactivatePerson` / `ReactivatePerson`) |

All new columns nullable (existing rows stay valid); `other_nationalities`
defaults to `{}`. `fullName` remains the display name and stays governed
with the identity group.

## The PII tier (C1, ratified)

`canViewPersonPII` = **owner, operations, hr**. Everyone else gets
**structural omission** — the fields are absent from the API response
entirely (the S41 financials law: absence, not masking). PII fields:
`dateOfBirth`, the address block, `phone`, `email`. (Document numbers join
this tier in S12.) Nationalities are identity facts, not PII — they stay
visible like `nationality` always has been.

## Editability (C2, ratified)

- **Identity-material changes are compliance facts** — a quiet edit could
  fake an age or a nationality. They go through the full pipeline:
  submit → review → approve → execute, requester ≠ approver, audited.
  The FIRST fill of an empty identity field is governed too — anything
  else would be a side door. (S5 imports already stage through
  governance, so bulk capture composes.)
- **Operational facts move fast** — team, position, contacts, notes are
  direct-but-audited (`PersonOperationalUpdated` with before/after),
  version-guarded (412 on stale).
- **Deactivation is governed** (`DeactivatePerson`, reason mandatory) —
  it feeds the future Departure workflow; a person leaving is a
  governance event, not an edit. `ReactivatePerson` mirrors it.
  Deactivation does NOT cascade (roster/journey/agreement records keep
  their own lifecycles and their own signals).

## Surfaces

- **PersonProfilePage**: identity card (governed "Request identity
  change…" drawer), PII block (visible only with standing; edit inline
  for those who can), operational block (Edit… direct), Deactivate…/
  Reactivate… governed actions. Pending identity/lifecycle requests show
  as in-motion on the page.
- **Approvals**: the three new operation types render their payloads
  (field-by-field before → after).
- Registers/exports/exit ceremony pick up the new columns (PII columns
  export only for PII-standing callers — the export is a read like any
  other).

## What S11 does NOT do

- No document numbers / typed credential taxonomy (S12).
- No Departure workflow (Track B) — deactivation just makes it possible.
- No self-service person portal; people ≠ members (identity boundary
  unchanged).
- No new signal kinds — readiness/rosters already watch active-ness;
  deactivated people fall out of active rosters via the existing checks.

## Evidence plan

- api: peopleV2.test.ts — PII omission per role (absent, not null);
  governed identity change happy path + separation + immutability of
  requester; operational direct edit + audit + 412; deactivate/reactivate
  governed; validation (dates, email shape).
- e2e: peopleV2.spec.ts — hr sees PII, finance does not (structural);
  operational edit direct; identity change through the full pipeline;
  deactivate → person drops from active pickers.
