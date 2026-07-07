# Sprint 36 — Credentials Domain (Design & Increment Plan)

**Author:** Architect-of-record · **Date:** 2026-07-07 · **Goal:** the second governed entity type — product depth toward the CP benchmark ("same or better than C3-on-SharePoint"), whose Credentials module is hosted-certified on the frozen reference.
**Claims discipline:** nothing here is publicly claimable until hosted-certified and worded by the truthfulness authority.

## Entity

**Credential** — `CRED-XXXX` (tenant-scoped business id), belongs to exactly one **Person** (by PER-XXXX within the tenant):

| Field | Type | Rules |
|---|---|---|
| credentialType | text, required ≤120 | e.g. "Coaching License A" |
| issuer | text, optional ≤160 | issuing body |
| issuedOn | **date** (plain), required | ISO `YYYY-MM-DD`, must be a real calendar date |
| expiresOn | **date** (plain), optional | null = non-expiring; when present, strictly after issuedOn |
| notes | text, optional ≤2000 | |
| isActive | boolean | governed deactivation flips it; reactivation = roadmap (CP parity: retired credentials stay retired) |

**CP lesson baked in (the SP date-swap incident):** dates are **plain `date` columns and ISO date strings end-to-end** — no timestamps, no timezone math anywhere in the path. The domain schema rejects impossible dates (e.g. Feb 30) and expiry ≤ issue.

## Governed operations (ADR-013 pattern, unchanged machinery)

- **AddCredential** — submit (owner/ops) → review/approve (owner ≠ requester) → execute creates the credential. `Approval.targetPersonId` carries the **owning person's PER-XXXX** (the column's natural fit); the created CRED id is recorded in the execution event + audit (targetId is write-once). Idempotency boundary: unique `created_by_approval_id` per tenant, exactly like Person.
- **DeactivateCredential** — governed flip to inactive. Target = the credential (payload carries credentialId + personId snapshot). Guards: credential exists, is active.
- Audit actions: `CredentialCreated`, `CredentialDeactivated` (approval-chain actions stay generic).

## Read surfaces (C4) — the first readiness-flavored view

- **Credentials register**: CRED id, person (linked), type, issuer, expiry, **derived status** — `Active` / `Expires soon` (≤30 days) / `Expired` / `Inactive`. Pure read-side derivation from `expiresOn` vs today; **no scheduler, no background jobs, display-only** (the honest seed of the readiness/Situation-Room direction).
- **Person profile**: a Credentials section listing that person's credentials with the same derived status.

## Persistence (C2, migration 0009)

`credential` table: tenant_id, credential_id, person_id (composite FK → person(tenant_id, person_id)), fields above, `created_by_approval_id` (unique per tenant, composite FK → approval), version, timestamps. **RLS ENABLE + FORCE** + tenant_isolation policy (data-plane table). Grants: c3_app SELECT/INSERT/UPDATE, never DELETE; c3_backup SELECT. Extensions: `business_id_counter.kind` CHECK + `approval.operation_type` CHECK + `allocateSequence` kind. Export/exit: `credential` joins the tenant-owned table set in `export:tenant` and `exit:tenant` (both must be extended + their tests).

## Increments

- **C1 — domain**: Credential entity, CRED ids, date-safe input schemas, payload union extension, audit actions, labels. Tests.
- **C2 — persistence + application**: migration 0009, writeTx/reads, submitAddCredential/submitDeactivateCredential, execute dispatch, export/exit table-set extension. DB + chain tests.
- **C3 — API**: routes (credentials register, per-person credentials, submit ops through the standard approval surface), contracts, HTTP tests.
- **C4 — web + deploy**: register + person-profile section + governed dialogs + derived-status badges, E2E; staging deploy (0009 owner paste → API owner deploy → web) + hosted verification.

Sequenced exactly like Sprint 35; each increment gate-green before the next.
