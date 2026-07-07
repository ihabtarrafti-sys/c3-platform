# A-8 Phase 2 — Governed Access Administration (Tenant-Admin) — Design

**Gate item:** completes A-8 (audit coverage of access-administration flows); unblocks parts of A-4; retires the "auditing manual SQL is impossible" compensating control. **Author:** Architect-of-record · **Date:** 2026-07-07 · **Status: DESIGN — groundwork only, no implementation.** Sequencing: this is the tenant-admin build (roadmap band 3); it must ship **before external orgs administer themselves** and is not needed for Controlled Internal Beta.

## Principle

Every access-administration change becomes a **first-class governed product flow** — same approval discipline as AddPerson, same append-only audit truth. Nothing about the auth model changes: Entra authenticates, the database's membership rows authorize, resolution stays per-request/uncached (A-7 revocation semantics are preserved *by construction*).

## The four operations (V1 of tenant-admin)

| Operation | Effect (on execute) | Approval discipline | Audit actions written |
|---|---|---|---|
| `ProvisionMember` | create `app_user` (if new) + `tenant_membership` + `role_assignment`; bind `external_identity` (provider, tid, oid) | governed: submit → review → approve → execute; requester ≠ approver | `MemberProvisionSubmitted/Approved/Rejected`, `MemberProvisioned` |
| `ChangeRole` | replace `role_assignment` rows for the member | governed | `RoleChangeSubmitted/…`, `RoleChanged` (before/after in the audit payload) |
| `DeactivateMember` | `app_user.is_active=false` (sole-tenant) or membership/role removal (shared) — the E1 primitive, productized | governed, but with an **emergency direct path** for `owner` (immediate lockout can't wait for a workflow) — the direct path still writes the audit event synchronously in the same transaction | `MemberDeactivated` (+ `EmergencyLockout` variant) |
| `ReactivateMember` | `is_active=true` / membership restore | governed (never emergency) | `MemberReactivated` |

Design invariants carried over from the certified core:
- **Immutable identity key**: (provider, tid, oid) is bound once at provision; email/display name remain mutable profile data. A provision for an already-bound oid is refused (mirrors the seed's ambiguity refusal).
- **No self-administration**: the requester cannot approve their own access change, and a member cannot change their *own* role or reactivate themselves (submit-only). The last active `owner` of a tenant cannot be deactivated or demoted (fail-closed guard — no ownerless tenants).
- **Tenant-scoped everything**: rows, approvals, audit events all carry `tenant_id`; RLS applies unchanged. Platform (cross-tenant) administration stays operator tooling, out of product scope.
- **Audit transactionality**: the audit event commits in the same transaction as the change — an unaudited access change is unrepresentable (same rule the AddPerson chain follows).

## What Phase 2 closes

- **A-8**: the coverage matrix's third row (access administration) flips to product-audited; E-9's weight lands. The interim compensating control (certification-document records of owner-run SQL) retires for tenant-scope changes.
- **A-4 (partially)**: role changes become exercisable in-product, so the role-model certification can drive its scenarios through real flows instead of seed SQL.
- **E-1 evolution**: runbook Step 2 (seed CLI) eventually reduces to platform bootstrap of the first owner; everything after becomes in-product.

## Deliberately out of scope (roadmap-honest)

Self-service org signup, invitation emails, customer-issuer federation (multi-tenant Entra), SCIM, group-based role sync. Each is a separate roadmap item; none may be claimed.

## Build shape (when scheduled)

Domain: 4 new operation types alongside `AddPerson`'s pattern (`packages/domain` op registry + zod payloads); ~10 new `AUDIT_ACTIONS` + D.6 labels. Application: use-cases mirroring the AddPerson chain (submit/review/approve/execute + guards above). Persistence: no schema change for members/roles (tables exist); one migration if `EmergencyLockout` wants a dedicated marker. Web: a Members register + governed dialogs (existing GovernedAction/DefinitionList/AuditTimeline primitives carry it). API: routes mirroring approvals. Estimate: one focused sprint, the largest single item after Credentials.
