# ADR-013 Addendum — Mission Kit Logistics Exemption

**Sprint:** 29A Phase 1
**Date:** 2026-07-03
**Status:** Approved (Sprint 29 Phase 0 governance classification, user-approved)
**Relates to:** ADR-013 (Governed operational-truth writes), ADR-013 Addendum — Journey
Lifecycle Transitions (S19 precedent)

---

## Decision

The following operations are **documented exemptions from the full ADR-013 approval loop**,
implemented as role-gated direct writes with mandatory validation, audit, and optimistic
concurrency:

| Operation | Classification | Allowed roles |
|---|---|---|
| `AddKitAssignment` | Role-gated operational creation | owner, operations |
| `UpdateKitStatus` | Documented lifecycle exemption (validated transition matrix) | owner, operations |
| `DeactivateKitAssignment` | Documented lifecycle exemption (mandatory reason) | owner, operations |
| `EditApparelProfile` (upsert) | Role-gated profile/master-data update | owner, operations, **hr** |

## Reasoning

1. **Risk:** kit issuance and fulfillment state are low-risk, reversible logistics records —
   no compliance (ADR-002) coupling, no finance coupling beyond trivial, no cross-domain
   cascade. Apparel sizing is master data, not operational truth.
2. **Frequency:** kit operations are the daily operational grind (items × participants ×
   missions). Routing each through owner approval would flood `C3Approvals` — the one
   monotonically-growing list already carrying the TD-19 top-500 risk — and train operators
   to rubber-stamp, degrading the governance signal for writes that matter.
3. **Auditability without approval:** SharePoint version history (major versions, retention
   raised to 50) records every change with the authenticated `Editor` identity;
   `StatusNotes` carries a readable audit line per lifecycle event. Attribution is therefore
   equivalent to the journey-lifecycle exemption precedent.

## Safeguards (mandatory, non-negotiable)

- **UI role checks are affordance, service validation is authority, SharePoint list
  permissions are the security boundary** (see the permissions checklist in the delta
  provisioning artifacts). All three layers are required.
- **Actor identity** comes exclusively from the authenticated AppContext `loginName` —
  never operator-entered, never form state. Services fail closed on empty actor.
  SharePoint `Editor`/version history is the authoritative actor record; `StatusNotes`
  is readable context, not the security source of truth.
- **Transition validation:** `UpdateKitStatus` enforces the approved transition matrix
  (shared pure module `utils/kitLifecycle.ts`); no arbitrary choice replacement; reasons
  mandatory for transitions into `Returned` / `Missing` / `Replaced` and for deactivation.
- **Optimistic concurrency:** every update resolves the exact row by canonical identity
  columns, MERGEs with the row's **actual ETag** (never `IF-MATCH: *`), and converts
  HTTP 412 into a clear concurrency error. Newer data is never silently overwritten.
- **Duplicate safety:** SharePoint `EnforceUniqueValues` on the deterministic display
  `Title` provides server-side race protection; unique-constraint failures are converted
  into domain duplicate errors. Title remains display/concurrency-enforcement only and is
  **never parsed for identity**.
- **History retention:** deactivation sets `IsActive = false`; rows are never physically
  deleted.
- **No silent failure:** every mutation surfaces success and every failure class
  (validation, duplicate, permission, concurrency, not-found, data-integrity, SP failure)
  to the operator.

## Explicit scope boundary

This addendum is a **narrow exception** covering exactly: kit assignment creation, validated
kit lifecycle transitions, kit deactivation, and low-risk apparel profile maintenance.

It does **NOT** establish a general exemption, and specifically does not cover:

- Mission participant membership (Add/Remove — **full ADR-013 governed**, Sprint 29B)
- Mission confirmation or mission status writes (TD-26 — deferred)
- Finance, budgeting, contracts, credentials, journeys, people, or any other
  operational-truth write
- Reactivation of deactivated records (deferred; requires its own classification)

Any future write outside this exact list requires its own governance classification before
implementation.

## Status

**Approved and locked** for the Sprint 29A implementation. Revisiting the classification
(e.g. promoting kit creation to full ADR-013) requires an explicit product decision.
