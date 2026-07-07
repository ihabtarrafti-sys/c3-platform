# E-1 — External-Org Onboarding Dry-Run

**Gate item:** E-1, Stage-4 admission gate. **Author:** Architect-of-record · **Date:** 2026-07-07.
**Result: PENDING — protocol designed, owner execution required.** The dry-run's purpose is to prove the *documented procedure* ([runbooks/E1-tenant-onboarding.md](../runbooks/E1-tenant-onboarding.md)) takes a new org from nothing to working isolated access — and, in the same drill, to hosted-prove the **full lifecycle** by offboarding the disposable org through the real exit ceremony. No pre-written results; this record fills in only after the hosted run.

## Design decision — one drill, full lifecycle

The dry-run onboards a **disposable synthetic org** (suggested slug `dryrun`), verifies it, then offboards it via `export:tenant` → E1 → `exit:tenant`. That makes E-1 also the **hosted certification of the exit ceremony** (B-5 item 3, currently test-green only) at zero risk: the erased org is the one created for the drill. certbeta is NOT used — it is a durable A-1 fixture and stays untouched.

## Protocol (owner-run; Architect verifies read-only)

**Phase 1 — Onboard (follows the runbook verbatim; deviations are findings):**
1. Owner creates ONE disposable identity: Entra B2B guest (preferred — exercises the external-identity path) or a tenant member, e.g. `dryrun-owner@…`. Record its oid.
2. Owner seeds tenant `dryrun` per runbook Step 2 (ops = synthetic placeholder, as certbeta precedent).
3. Owner signs in with the dryrun identity: verify empty own org, tenant chip `dryrun`.
4. Isolation probes (runbook Step 3.2): deep-links to `PER-0001`/`APR-0001` → not found.
5. Architect verifies read-only: membership rows, `SessionEstablished` row in dryrun's audit stream, zero business rows.
6. Optional strengthener: one governed AddPerson in dryrun (needs 2nd identity or owner-approves-other-submitter pattern) — proves the governed flow inside a fresh org.

**Phase 2 — Offboard (the lifecycle back half):**
7. `export:tenant --tenant-slug dryrun --out <dir>` (owner-run, admin URL one-shot) — data return; keep `manifest.json`.
8. E1: deactivate the dryrun identity (`is_active=false`) → owner confirms the next request is denied (A-7 behavior re-witnessed).
9. `exit:tenant --tenant-slug dryrun` **dry-run** — review the report.
10. Execute with dual authorization (Owner types `--confirm dryrun`; Architect authorizes the second factor `C3_EXIT_SECOND_CONFIRM=dryrun` — two humans): single-transaction erasure with in-tx zero-row post-checks.
11. Architect verifies read-only: tenant gone, zero rows, certbeta + c3-internal untouched, append-only triggers still enforcing on live streams.
12. Entra cleanup: owner deletes/disables the disposable guest identity.

## Acceptance criteria (all must hold)

- Onboarding completed **using only the runbook** — any needed off-script step is recorded as a runbook defect and fixed before E-1 is called green.
- Fresh org: correct empty landing, isolation probes negative, `SessionEstablished` audited.
- Offboarding: export bundle produced (manifest retained), E1 denial witnessed, exit ceremony committed with clean post-checks, other tenants provably untouched.
- Total owner effort target: **≤ 30 minutes**. If it takes materially longer, that is itself a finding for the external-readiness assessment.

## Gate consequence

E-1 green (with this record updated to the evidence) + `exit:tenant` HOSTED-PROVEN closes the last Architect-owned drill in Block A/E. Remaining non-Architect items: A-4 (role accounts), B-5 item 4 (retention policy), C-2 (commissioned assessment), owner acceptances.
