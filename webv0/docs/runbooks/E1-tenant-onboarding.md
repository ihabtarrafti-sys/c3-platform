# Runbook — Tenant Onboarding (V0)

**Purpose:** take a new organization from nothing to working, isolated, governed access on the hosted environment — using only this document. This is the procedure gate item **E-1** dry-runs. Owner-run (staging writes are owner-executed); the Architect verifies read-only.
**Scope honesty:** V0 identity model. Token validation is **pinned to the c3hq Entra tenant** (single issuer). Therefore every onboarded user must be a member **or Entra B2B guest** of the c3hq tenant — a guest signs in with their own credentials, and their token carries **our `tid` + their guest `oid`**, which is exactly the immutable `(tid, oid)` identity key the platform binds to. Native multi-issuer (customer's own Entra tenant as issuer) is roadmap work and NOT claimable.

## Inputs (collect before starting)

| Input | Example | Notes |
|---|---|---|
| Org name + slug | `Certbeta Ltd` / `certbeta` | slug: lower-case `[a-z0-9-]`, permanent |
| Owner identity | email + display name | will be invited as B2B guest if external |
| Operations identity (optional at first) | email + display name | may be a synthetic placeholder initially; the seed requires an ops entry |

## Step 1 — Identity provisioning (Entra admin center)

1. If the user is external: **Entra admin center → Users → Invite external user** (B2B guest). The user redeems the invitation once.
2. Record the guest/member's **Object ID (oid)** from their Entra user page. This — not the email — is the membership key.
3. No app-role or group assignment is needed: C3 authorization is **database membership**, resolved per-request; Entra only authenticates.

## Step 2 — Seed the tenant (owner-run, one paste)

From `webv0/` with the documented Railway psql-stdin path, or via the seed CLI with `DATABASE_ADMIN_URL` (one-shot, never persisted):
```
npm run seed:staging -- \
  --tenant-slug <slug> --tenant-name "<Org Name>" \
  --entra-tenant-id 295213e5-<c3hq tenant guid> \
  --owner-oid <owner-oid> --owner-email <owner-email> --owner-name "<Owner Name>" \
  --ops-oid <ops-oid-or-placeholder> --ops-email <ops-email> --ops-name "<Ops Name>"
```
Properties (already certified): idempotent, refuses ambiguous identity bindings, prints a redacted reconciliation. The tenant starts **empty** — no people, no approvals, counters at zero.

## Step 3 — Verification checklist (the org is live when ALL pass)

1. **Sign-in:** the owner identity signs in at `staging.c3hq.org` → lands in **their own, empty org** (tenant chip = their slug; People "No people yet").
2. **Isolation probes:** deep-link another org's records (e.g. `/people/PER-0001`, `/approvals/APR-0001`) → **not found**; register counts are their own only. (A-1-certified behavior; re-verify per onboarding.)
3. **Governed flow:** submit one Add Person → approve → execute (or defer until a second identity exists — the requester cannot approve their own request). Verify the workflow history recorded it.
4. **Audit:** the sign-in wrote `SessionEstablished` (Access) in *their* tenant audit stream (A-8 P1).
5. **Revocation drill (optional but recommended):** flip `is_active=false` → next request is denied; restore → access returns (A-7-certified timing).

## Step 4 — Record

Add the org to the tenant register (slug, tenant uuid, identities + oids, date, verification outcomes). The seed reconciliation output is the evidence artifact.

## Offboarding (the same lifecycle, reversed)

Documented separately and fully tooled: data return via `export:tenant` → Phase E1 access termination → Phase E2 erasure ceremony via `exit:tenant` — see [B5-exit-tenant-ceremony.md](B5-exit-tenant-ceremony.md).

## Known V0 limits (state honestly to any prospect)

- Identity: B2B-guest model (above); customer-issuer federation is roadmap.
- Provisioning is **operator-run tooling**, not self-service tenant admin (that build is the A-8 Phase 2 / tenant-admin milestone).
- One governed operation type (AddPerson) is hosted-certified; further domains are roadmap.
