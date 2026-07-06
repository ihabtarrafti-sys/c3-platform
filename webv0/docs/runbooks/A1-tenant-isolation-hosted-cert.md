# A-1 — Multi-Tenant Isolation: Hosted Certification Runbook

**Track A, gate item A-1** (`STAGE-4-EXTERNAL-BETA-ENTRY-GATE.md`). **Owner:** Architect-of-record.
**Goal:** move A-1 from *source/test-verified mechanism* to **Hosted-certified** — cross-tenant probes deny at the **policy** and **RLS** layers on the real staging environment (Railway PostgreSQL + real Entra), with a real second tenant.

## Mechanism — already proven at source/test (the certification basis)

The isolation mechanism is defense-in-depth and comprehensively proven against a real PostgreSQL (embedded) with two tenants. These are the proofs the hosted probes mirror:

| Layer | Proof (source/test) | Where |
|-------|---------------------|-------|
| **Policy (API)** | tenant-B identity reading/acting on a tenant-A approval → **404** (existence not leaked) | `apps/api/test/api.test.ts` — "another tenant cannot read or act on an approval (404)" |
| **Policy (API)** | a **forged token** carrying `tenant_id`/`tenant_slug` is ignored — tenant comes from DB membership on immutable `(tid,oid)` | `api.test.ts` (forged-claims case); `entraIdentity.test.ts` (role/groups/wids cannot escalate) |
| **RLS (DB)** | tenant A cannot read tenant B rows; cross-tenant write is invisible/no-op | `packages/persistence/test/db.test.ts` — "tenant isolation (RLS)" |
| **RLS (DB)** | missing tenant context fails closed (0 rows); `app.tenant_id` is transaction-local (no pool leak) | `db.test.ts` — fail-closed + connection-pool isolation |
| **Role** | `c3_app` is `NOT superuser`, `NOT bypassrls` — cannot bypass RLS; only `c3_backup` has the one documented BYPASSRLS exception | `db.test.ts` — admin/app separation + backup posture |

**These do not need re-doing.** A-1 hosted cert = reproducing the *policy* and *RLS* cross-tenant denials once, on staging, with a live second tenant.

## Owner provisioning spec (what unblocks A-1)

Two things, both owner actions:

1. **A second Entra identity** in the staging Entra directory (`tid = 295213e5-…`) — a test account (e.g. `certbeta@…`) distinct from the owner/operations identities. Provide its **object id (oid)**, email, and display name. *(It only needs to exist in the directory; no special roles.)*
2. **A second C3 tenant** seeded on staging via the owner-run seed command (same path as the geekay seed), with that identity as its owner and **no membership in the existing `c3-internal` tenant**:

   ```
   seed:staging --tenant-slug certbeta --tenant-name "Cert Beta Org" \
     --entra-tenant-id 295213e5-… \
     --owner-oid <CERTBETA_OID> --owner-email certbeta@… --owner-name "Cert Beta Owner"
   ```

The two tenants must be **disjoint**: identity A (Ihab) ∈ `c3-internal` only; identity B (certbeta) ∈ `certbeta` only.

## Hosted probe checklist (jointly run — owner authenticates each identity)

Signing in requires each identity's own credentials, so this is a joint owner+architect exercise (like the Phase 2C smoke). For each probe, capture the response (status/body) as evidence.

**A → B direction (identity A = Ihab / `c3-internal`):**
- [ ] `GET /api/v1/people` returns only `c3-internal` people (incl. `PER-0001`); **never** certbeta rows.
- [ ] `GET /api/v1/approvals` returns only `c3-internal` approvals (`APR-0001/0002`).
- [ ] Deep-link `GET /api/v1/people/<certbeta PER id>` → **404** (not tenant A's).
- [ ] Deep-link `GET /api/v1/approvals/<certbeta APR id>` → **404**; a governed action on it → **404**.

**B → A direction (identity B = certbeta):**
- [ ] `GET /api/v1/people` on a fresh certbeta tenant → **empty** (does **not** see `PER-0001`).
- [ ] `GET /api/v1/approvals` → empty (does **not** see `APR-0001/0002`).
- [ ] Deep-link `GET /api/v1/people/PER-0001` → **404**.
- [ ] Deep-link `GET /api/v1/approvals/APR-0001` + `POST …/begin-review` → **404** (cannot read or act).

**RLS layer (DB, via `railway ssh` — admin read-only inspection):**
- [ ] With `app.tenant_id` unset on a `c3_app` connection: `SELECT * FROM person` → **0 rows** (fail-closed).
- [ ] With `app.tenant_id` = certbeta: sees only certbeta rows; with = c3-internal: only c3-internal rows.
- [ ] `SELECT rolbypassrls FROM pg_roles WHERE rolname='c3_app'` → **false** (matches source/test).

**Evidence capture:** record each probe's result into the product-lane certification record (BETA-REGISTERS). A-1 is **Hosted-certified** only when every box is green with retained evidence.

## After A-1

Certifying A-1 hosted also produces most of the evidence for **A-4** (full role model hosted) if identity B is exercised across the role set — schedule the two together once the second identity + role accounts exist.
