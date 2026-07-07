# E-1 — External-Org Onboarding Dry-Run

**Gate item:** E-1, Stage-4 admission gate. **Author:** Architect-of-record · **Date:** 2026-07-07.
**Result: ✅ PASSED — full lifecycle hosted-certified 2026-07-07 (executed ~15:23–15:52 UTC+1).** The drill onboarded a disposable org using only the documented runbook, verified it live, and offboarded it through the real export + exit ceremony. **This run also HOSTED-PROVES the `exit:tenant` erasure ceremony (B-5 item 3) and the A-8 P1 `AccessDenied` forensic stream.**

## Evidence (hosted, 2026-07-07)

**Onboard (owner-run, runbook-verbatim):** Entra B2B guest created (personal-mailbox home identity; oid `f9c47412…da2d`); tenant `dryrun` (`b88ff62d…`) seeded with synthetic profile emails; guest signed in with home credentials → landed in **own empty org** (IdentityBar "Dryrun Owner", tenant chip `dryrun`, "No people yet"); isolation probes `PER-0001`/`APR-0001` → **not found**. Architect read-only verification: 2 members exact, both identity bindings exact, **6 live `SessionEstablished` audit rows** written by the real sign-in (one per `/me` call — multiple per visit is expected SPA behavior; benign observation), zero business rows, other tenants untouched. **The B2B-guest identity path works end-to-end on the hosted product** — first external-style identity onboarded.

**Data return:** `export:tenant` produced 10 JSONL files + checksummed manifest — 15 rows (incl. the 6 audit events), schema at 7 migrations. Bundle + manifest retained at the owner's machine.

**E1 termination:** both dryrun users deactivated; guest's next requests **denied** — witnessed live and forensically recorded: **5 `AccessDenied` rows in `access_event` carrying the guest oid** (the platform denial stream's first live entries — A-8 P1 denial path now hosted-proven).

**E2 erasure ceremony (`exit:tenant`):** dry-run reviewed (0 active members, 15 rows across 10 tables, 2 sole users, 0 shared) → **dual-authorized execute** (Owner typed `--confirm`; Architect's written authorization in-session = second factor, `C3_EXIT_SECOND_CONFIRM`), with the export manifest verified as data-return proof. Reconciliation: 15 rows erased, `post-checks zeroRows=true tenantRowGone=true triggersReEnabled=true`. Architect read-only verification: zero `dryrun` rows anywhere, **zero orphan rows platform-wide**, append-only triggers `2/2` re-enabled, `c3-internal` (1 person / 3 approvals) and `certbeta` (2 members) intact, exactly 2 tenants remain. **This report is the exit-register entry.**

**Owner effort:** well under the 30-minute target across both halves.

## Findings (honest)

1. **Runbook deviation (now documented as the standard path):** the repo CLIs (`export:tenant`, `exit:tenant`) were run from the owner's machine against the Railway Postgres **public proxy** (`DATABASE_PUBLIC_URL`) with one-shot env vars — the runbooks assumed a local `DATABASE_ADMIN_URL` without saying where it comes from. This works and is acceptable owner practice, with the hygiene rule: env var one-shot, never persisted, never pasted into shared channels.
2. **Credential exposure incident — CLOSED 2026-07-07 same day:** the owner pasted the full admin URL (incl. the Postgres superuser password) into the session transcript while reporting results. Contained (staging, synthetic data) and remediated with three-axis verification by the Architect: **(a)** password rotated (in-container psql consistent with the new value); **(b)** the leaked credential is dead — connection to the old public proxy endpoint resets (**the public TCP proxy is DISABLED**; re-enable transiently only for owner-run repo CLIs, then disable again); **(c)** API health 200 throughout (runtime roles were never exposed — only the superuser credential leaked, and nothing at runtime consumes it). **Not an admission blocker: evidenced complete.**
3. `SessionEstablished` writes once per `/me` call (several per browsing session). Fine at current scale; consider per-session dedup only if volume ever matters. Not a defect.
4. Entra cleanup: the E-1 disposable guest was **deleted by the owner (confirmed 2026-07-07)**. The A-4 drill's `Role Test` guest deletion is requested and pending owner confirmation (tracked in `A4-role-model-hosted-cert.md`).

## Design note that made this cheap

One drill certified **three** things (E-1 onboarding, the B-5 exit ceremony hosted, the A-8 denial stream live) at zero risk, because the org being erased was the org created for the drill. certbeta was never touched.

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
