# C3 Authoritative Continuity Index

**Created:** 2026-07-05 · **Repo:** c3-platform (`C:\Projects\c3-fable`), branch `master`
**Purpose:** one entry point that says where truth lives. This index identifies
authoritative sources — it never duplicates them.

## Authority order

1. **Current repository source** (master HEAD);
2. **Current hosted behavior** (https://geekaygames.sharepoint.com/sites/C3);
3. Latest baseline / closeout / checkpoint / Internal V1.0 marker / certification record;
4. Latest Claude Code handoff;
5. Authoritative project handoff and decision ledger;
6. Older materials (historical only).

Where documents disagree, the higher authority wins. Known stale artifacts:
`PROJECT_STATUS.md` (Sprint-14 era) and the root `Engineering Handover
Package.md` are historical; the authoritative handoff itself is dated
Sprint 26 and is extended by dated addenda rather than rewritten.

## Authoritative sources by topic

| Topic | Authoritative source |
| --- | --- |
| Architecture | `docs/architecture/C3 Architecture Baseline — Sprint 31.md` + `docs/adr/` (ADR-001…013 + addenda) |
| Current product state | `docs/architecture/C3 Internal V1.0 Baseline Marker.md` (declared state, frozen) + `docs/architecture/Sprint 32 Closeout Report.md` + `docs/architecture/Sprint 33 — Priority Correction Set (TD-34 + Identity).md` (latest hosted-green state) |
| Hosted certification | `docs/architecture/Sprint 33 Phase 0 — Functional Certification Inventory.md` (scope) + `docs/architecture/Sprint 33 Phase 1 — Hosted Certification Record.md` (evidence + blockers) |
| Decisions | `docs/fable/C3_Authoritative_Project_Handoff_2026-07-02.md` §4 "Locked Decisions and ADR Register" (untracked working copy; extended by dated addenda) + `docs/adr/` for architecture decisions |
| Technical debt | `docs/architecture/C3 Tech Debt Register.md` |
| Brand identity + public website | `docs/continuity/C3-BRAND-WEBSITE-RECORD-2026-07-05.md` (in this repo) → canonical detail: `C:\Projects\c3-website\docs\C3-WEBSITE-IDENTITY-CLOSEOUT-v1.1.0.md` |
| Latest Claude Code handoff | `docs/fable/C3_Authoritative_Project_Handoff_2026-07-02.md` + this index + the Sprint 33 records above |
| Active workstream | **Sprint 33 — Full Functional Certification and Controlled Internal Beta** (see boundary below) |

## Version truth (as of 2026-07-05, HEAD `e376a8b`)

- **Deployed hosted solution: 1.0.0.5** — S33 correction set closed
  hosted-green on it (TD-34 resolved; cold-load acceptance 5/5).
- **Built at HEAD, NOT deployed: 1.0.0.6** (TD-33 tabster-sandbox interop
  fix, commit `8f3320e`); requires its own owner-authorized deployment and
  hosted validation cycle.
- Internal V1.0 was **declared** on solution 1.0.0.2 / runtime
  `bb2ffba3…` — those values are frozen in the V1 marker and are NOT the
  current versions.
- Current committed runtime chunk (1.0.0.6 build):
  `chunk.c3-runtime_cb48f647a6bf9a817533.js`, SHA-256 `1714af55394cff0a…`.

## Current product boundary

- **C3 Internal V1.0 is declared** (marker: commit `3241213`, 2026-07-05).
- **Sprint 32 is closed.**
- **Contracts is canonical, ACL-hardened (exact five principals), active,
  and application read-only.**
- Core Contract navigation, People linkage, Renewals, modal behavior, host
  hardening, and the V1 closeout are **complete**.
- **TD-34 is RESOLVED** (S33, 1.0.0.5 hosted-green — proven cause corrected;
  supersedes earlier "accepted debt" phrasing). The bounded TD-33
  foreign-instance first-modal residual is tracked in the Tech Debt
  Register; its fix is built (1.0.0.6) and awaits hosted validation.
- Mission Readiness Cockpit remains **future work**.
- **The only active product workstream is Sprint 33 — Full Functional
  Certification and Controlled Internal Beta.** No major feature work is
  authorized before certification.

## Sprint 33 priority order

1. Certify every intended Internal V1 function in hosted SharePoint;
2. Identify Mock-only, source-only, hidden, deferred, defective, or
   unverified functionality;
3. Fix only defects proven through certification;
4. Validate roles, ACLs, ETags, recovery, and truthful states;
5. Begin controlled beta only after entry criteria are met.

## Open certification risks (carried into the next tranche)

- Writes, approvals, exemptions, role boundaries, and cross-domain
  workflows still require hosted evidence (Phase 1C/1D/1E blocked on a
  distinct non-owner submitter account in C3 Operations + fixtures).
- Hosted SPFx historically ran `disableToasts: true` — governed writes must
  never appear silent (RISK-1 inline-notification fix is hosted-verified;
  keep certifying every write path).
- Mission finance and milestone SharePoint services are **stubbed**; the
  Situation Room must show them as unavailable/deferred — missing or zero
  data must never appear healthy, complete, or ready.
- Owner, Operations, and at least one read-only role must be certified
  before beta.
- Dedicated fixtures are required; genuine operational records must not be
  altered for testing (APR-0034/0045 untouched; APR-0054 is preserved
  evidence — never approve/execute/recycle; GKE-PL-2026-001 untouched).
- AddPerson synthetic-fixture decisions remain **owner-gated** (creation is
  not fully reversible).

## Exact next action

> Resume Sprint 33 by reconciling the current certification matrix against
> source and hosted evidence, then prepare the next controlled hosted
> certification tranche. Do not implement a new product feature.
