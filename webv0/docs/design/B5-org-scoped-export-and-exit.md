# B-5 — Organization-Scoped Export & Deletion/Exit (Design)

**Gate item:** B-5 (+ the A-5 per-org-restore remainder), Stage-4 admission gate. **Status: DESIGN — nothing here is implemented; nothing is promised publicly** (the claims sign-off already prohibits export/deletion claims). **Author:** Architect-of-record · **Date:** 2026-07-07 · repo tip `65741cb`.
**Decision owners:** technical design = Architect (this doc); retention/deletion policy acceptance = **Owner + Counsel** (explicitly required by the gate).

## The design tension, stated honestly

C3's trust story rests on **append-only, trigger-enforced audit history** (24-month retention, D-24) and **immutable approval payloads**. A customer's exit rights ("give me my data, then delete it") collide with that discipline by design. The resolution below separates *access termination* (instant), *data return* (export), and *data erasure* (scheduled, policy-bound) instead of pretending one DELETE can honor both obligations.

## 1. Export (org-scoped data return)

**Scope of an export bundle for tenant T** — everything T owns, nothing anyone else owns:
- Operational: `person` rows (tenant T).
- Governance: `approval` (incl. immutable payloads), `approval_event`, `audit_event` (tenant T).
- Directory: T's `tenant` row, `tenant_membership` + `role_assignment` for T, and the `app_user` + `external_identity` rows of T's members — **flagging any user who is also a member of another tenant** (shared identities are exported as profile-only, marked `shared: true`).
- Excluded: `business_id_counter` internals (metadata, exported as plain values), `access_event` (platform-level, no tenant key — denials are not the org's records), platform logs.

**Mechanism (V0):** an owner-run CLI in the seed/migrate family — `export:tenant --tenant-slug T --out <dir>` — running on the **privileged admin connection** (read-only queries only), emitting one JSONL file per table + a `manifest.json` (row counts, SHA-256 per file, tenant id/slug, timestamp, schema version = applied migrations). Deterministic ordering for reproducibility. Product self-serve export is a tenant-admin feature (roadmap band 3), not V0.

**Verification:** manifest counts cross-checked against live `count(*)` per table at export time; the drill (below) re-verifies.

## 2. Exit (the two-phase deletion answer)

**Phase E1 — Access termination (immediate, already proven):** set all of T's memberships inactive (`is_active=false` for sole-tenant users; membership/role removal for shared users). Effect is next-request (A-7 hosted-certified). Tenant is marked exited (V0: role removal + a documented register entry; a `tenant.status` column is a candidate tenant-admin migration, not required for the mechanism).

**Phase E2 — Erasure (after the agreed retention window):**
- **What is erased:** all tenant-T rows across `person`, `approval`, `approval_event`, `audit_event`, `business_id_counter`, `tenant_membership`, `role_assignment`, sole-tenant `app_user`/`external_identity` rows, and finally the `tenant` row.
- **How, honestly:** the append-only triggers block DELETE **by design, even for the owner**. Erasure is therefore a documented, dual-authorized (Owner + Architect) maintenance procedure: single transaction, `ALTER TABLE … DISABLE TRIGGER <append_only>` → tenant-scoped DELETEs → re-enable triggers → post-checks. This is deliberate friction: org erasure is a ceremony, not an API call. (A future `exit:tenant` CLI wraps exactly this, with a dry-run mode, refusal on active memberships, and a printed reconciliation — same family as the seed.)
- **When:** POLICY DECISION (Owner + Counsel): recommended default — **operational + governance records erased at exit + 30 days; audit events retained to the D-24 horizon (24 months from event) under legal-hold reasoning, then purged**. Counsel may instead accept full erasure at exit; the mechanism supports either. The chosen policy goes in the DPA/exit schedule — the drafted legal pack already carries the placeholder.

**Verification checklist (per exit):** zero rows for T across all tables; API deep-links 404; counters absent; a signed reconciliation record retained (the record *of* the erasure is not the erased data).

## 3. Backups (the honest residual)

Erased data **persists inside encrypted whole-database backups until lifecycle expiry** — R2: daily 15d / weekly 90d / manual 180d. Selective in-backup purging is not offered (industry standard; the backups are age-encrypted blobs). Therefore the truthful maximum residual horizon after erasure = **180 days**, stated in the exit schedule. **Restore discipline (runbook rule):** any restore performed after an exit must re-apply that exit's erasure before the restored data serves traffic; the exit register is the checklist source.

## 4. Logs

Platform logs (Railway) are short-retention, contain no request bodies or tokens (redaction test-enforced), and expire on platform schedule; no org-scoped log purge is offered or needed. Stated as-is in the legal pack.

## 5. Per-organization restore (closes the A-5 remainder)

Whole-DB restore into a scratch database is already hosted-certified (Phase 2D drill). **Per-org restore = composition, no new backup infrastructure:** restore backup → scratch DB (proven) → run `export:tenant` against the scratch DB → the bundle is the org's point-in-time data. V0 re-import is a manual, owner-driven reconciliation (adequate for internal beta; a guarded `import:tenant` is future tenant-admin work). A-5 goes green when: this composed procedure is drilled once end-to-end **and** the Owner accepts the posture for the external context.

## 6. Sequencing & effort

1. **DONE** — `export:tenant` CLI + core + 4 tests + real-CLI smoke (`packages/persistence/src/exportTenant.ts`, `npm run export:tenant`). Read-only snapshot, checksummed manifest, shared-user withholding, unknown-slug refusal.
2. **WIRED, hosted drill PENDING owner** — composed per-org restore: `RESTORE_EXPORT_TENANT=<slug>` runs the export against the disposable restored DB inside the existing 2D drill (`apps/backup/src/restore-main.ts` + `resolveExportTenant` guard + 3 unit tests). Runbook: [runbooks/A5-per-org-restore-composed-drill.md](../runbooks/A5-per-org-restore-composed-drill.md); status: [certifications/A5-per-org-restore.md](../certifications/A5-per-org-restore.md). → **A-5 greens** on the hosted run + owner acceptance.
3. Exit ceremony runbook + `exit:tenant` dry-run tooling (medium; the erasure transaction itself is simple — the value is the guardrails). *(not yet built)*
4. Owner + Counsel retention-policy decision → exit schedule text in the legal pack. → **B-5 green**. *(policy gate)*

Items 1–3 are self-service builds (1 done, 2 wired); item 4 is the policy gate. Nothing publishes any capability claim until drilled and certified.
