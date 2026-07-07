# A-1 — Multi-Tenant Isolation: HOSTED CERTIFICATION RECORD

**Gate item:** A-1, `c3-governance/operations/web-v0-beta/stage-4-external/STAGE-4-EXTERNAL-BETA-ENTRY-GATE.md`
**Status: HOSTED-CERTIFIED** · **Date:** 2026-07-07 · **Certified by:** Architect-of-record (RLS-layer probes) + Platform Owner (policy-layer browser probes, jointly run)
**Runbook followed:** `../runbooks/A1-tenant-isolation-hosted-cert.md`

## Environment

- Hosted staging: `staging.c3hq.org` (SPA) + `api.staging.c3hq.org` (API) + Railway PostgreSQL (private network), real Microsoft Entra sign-in.
- Web bundle at certification: `index-mNxUSC98.js` (source `ecd602f` lineage); repo tip during cert: `2ddd613`.

## The two live tenants (disjoint by construction)

| Tenant | slug | uuid | Members |
| --- | --- | --- | --- |
| A | `c3-internal` | `7f46d30b-1652-4079-9af1-4d560ab9a6ae` | Ihab (owner), M. Khalailah (operations) — **not** in certbeta |
| B | `certbeta` | `543ca1d7-584f-4d91-9775-f5cd209e17a7` | `certbeta@c3hq.org` (owner, real Entra oid `7554d782-…`), `certbeta-ops@synthetic.invalid` (operations, synthetic placeholder — cannot sign in) — **not** in c3-internal |

Tenant B seeded 2026-07-07 by the owner (idempotent SQL reproducing `seedStaging.ts` semantics; baseline pre-checked clean: no slug/email/oid collisions). Fixture is durable and reusable for re-certification; reversible via `DELETE FROM tenant WHERE slug='certbeta'` (cascades to membership/roles).

## RLS-layer probes — PASS (Architect, read-only, staging Railway PG)

Run via `railway ssh --service Postgres` → in-container psql, then `SET ROLE c3_app` (the non-bypassing app role; verified `acting_as=c3_app`) so RLS applies:

| Probe | Result |
| --- | --- |
| No tenant context (`app.tenant_id` unset) | `person=0, approval=0` — **fail-closed** ✅ |
| Context = certbeta (tenant B) | `person=0, approval=0` — zero rows of tenant A's data ✅ |
| Context = c3-internal (tenant A) | `person=1, approval=3` — exactly its own fixtures (PER-0001, APR-0001/0002 + cert-day approval) ✅ |
| Incidental grant proof | `c3_app` has **no SELECT on `tenant`** (control-plane least privilege held: `permission denied for table tenant`) ✅ |

## Policy-layer probes — PASS (Owner, real Entra sign-in as certbeta, 2026-07-07)

Signed in at `staging.c3hq.org` as `certbeta@c3hq.org` (private window, real Microsoft sign-in):

| Probe | Result |
| --- | --- |
| Landing state | Empty People register; tenant indicator shows **certbeta** (not c3-internal) ✅ |
| Deep-link `/people/PER-0001` (tenant A's person) | **Not found** ✅ |
| Deep-link `/approvals/APR-0001` (tenant A's approval) | **Not found** ✅ |

Existence is not leaked (404-shaped denial, not 403), matching the source/test contract (`apps/api/test/api.test.ts`).

## Certification basis (mechanism, already source/test-proven)

Policy layer: tenant derived solely from DB membership on immutable `(tid, oid)`; forged token tenant claims ignored; cross-tenant reads/acts → 404 (`api.test.ts`, `entraIdentity.test.ts`). RLS layer: ENABLE+FORCE policies, transaction-local `app.tenant_id`, pool-leak-proof, `c3_app` NOSUPERUSER/NOBYPASSRLS (`db.test.ts`, migration `0002_rls.sql`). The hosted probes above reproduce each contract on the live environment — **both layers deny with zero rows, exactly as the gate requires (E-7).**

## Consequences

- Gate **A-1 → Hosted-certified** (was: source/test-verified only). Surface to the External-Beta lane on its reopening.
- Public-claims impact: per `C3-CLAIMS-TRUTHFULNESS-SIGNOFF.md`, tenant-isolation wording was prohibited *until A-1 hosted-green* — a truthful, evidence-linked isolation claim may now be drafted (requires a fresh Architect truthfulness pass on exact wording; not automatic).
- The certbeta fixture + real second identity also unlock **A-4** (role-model certification) and later **E-1** (onboarding dry-run).
