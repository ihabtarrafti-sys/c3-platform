# CP-Parity Reconciliation — the "Same or Better" Audit (Sprint 40)

**Author:** Architect-of-record · **Date:** 2026-07-08 · **Status: AUDIT OF RECORD**
**The strategic bar (Owner, 2026-07-06):** the SaaS must prove **"same or better than the CP project"** — CP = C3-on-SharePoint, the frozen SPFx app, hosted-certified through Sprint 33. This document is the line-by-line reconciliation of every certified CP capability against webv0, with hosted evidence cited on both sides and an honest deferred list. Nothing here is a public claim; external wording routes through the truthfulness sign-off separately.

## Authority sources

**CP side** (frozen workspace, `C:\Projects\c3-fable` root):
- `docs/architecture/Sprint 33 Phase 0 — Functional Certification Inventory.md` — the definitive intended-function matrix (§3) and V1 exclusions (§12).
- `docs/architecture/Sprint 33 Phase 1 — Hosted Certification Record.md` + `…Phase 1C-1D — Governed-Write Certification Record.md` (1.0.0.6, PER-0025, APR-0055..0062: all 6 governed chains + rejection + ExecutionFailed/resubmit recovery + journey/kit/apparel exemptions).
- `…Correction Set C` (credential dates + ACL least-privilege) · `…Set D` (submission-time active-participant guard, APR-0065..0069) · `…Set E` (visitor truthfulness / sensitive-data boundary). Final CP runtime 1.0.0.8: all four role families hosted-certified (Owner, Operations, Management read-only, Visitor).

**webv0 side** (`webv0/docs/certifications/`): Phase 2C/2D hosted certs, A-1…A-8, E-1, S36-credentials, S37-journeys, S38-kit-apparel, S39-missions (+ `docs/design/*` for pattern intent). Staging = staging.c3hq.org / api.staging.c3hq.org, migrations 12/12.

**Legend:** **SAME** = capability and certified behavior equivalent · **BETTER** = equivalent plus a strengthening the CP could not offer · **DIFFERENT-COVERED** = re-modeled deliberately, capability preserved · **DEFERRED** = CP had it (as certified), webv0 does not yet · **N/A-CP** = CP never offered it (excluded from V1 cert), so no parity obligation.

---

## 1. The governed core (the product's identity)

| Capability | CP evidence | webv0 evidence | Verdict |
|---|---|---|---|
| Governed operation pipeline (submit → review → approve/reject → execute) | ADR-013; 1C-1D chains A–F | Every domain cert; approval routes | **SAME** semantics, **BETTER** enforcement: DB transactions + append-only event streams (DB-triggered) vs list rows + StatusNotes |
| Requester ≠ approver (self-approval refusal) | 1C-1D REST 403 proof | `checkSelfReview` fail-closed; hosted across S36–S39 (every APR sub=ops, rev=owner) | **SAME** |
| Reject requires reason | APR-0057 | rejectRequestSchema (mandatory, 1–1000 chars); hosted APR history | **SAME** |
| Execute idempotency / no partial-as-success | 1C-1D "no partial-as-success"; Recover Execution Stamp (3 paths) for partial stamps | Single-transaction execute: partial stamps are **unrepresentable**; idempotent re-execute returns what was created; 23505 recovery | **BETTER** — the failure class CP needed a recovery tool for is designed out |
| ExecutionFailed → recovery | APR-0060 → resubmit APR-0061 (resubmit-only; CP had no re-execute for clean failures — recorded finding) | Truthful ExecutionFailed + resubmit **and** direct re-execute from ExecutionFailed (`canApply('executeSuccess')`) | **BETTER** |
| Governed operation set | 6 op types | **10** op types: the CP six **plus** ProvisionMember/ChangeRole/DeactivateMember/ReactivateMember | **BETTER** (superset; see §5) |
| Concurrency: stale-write refusal | Real-ETag 412 drills (list MERGE) | Version-guarded UPDATE … WHERE; 409 CONCURRENCY with zero change, proven over HTTP in every domain | **SAME** discipline (status code differs by transport; behavior identical) |
| Write feedback (CP RISK-1: toasts disabled hosted) | Inline-notification fix hosted-verified | Notification surface + honest-immediacy dialog copy, E2E-asserted | **SAME** |

## 2. Domain-by-domain

| Domain | CP certified behavior | webv0 certified behavior | Verdict |
|---|---|---|---|
| **People** | Register + Person Profile + governed AddPerson (PER-0025) | Register + profile + governed AddPerson (PER-0001 staging; E2E) | **SAME** |
| **Credentials** | Governed Add/Deactivate (CRED-0024); Set C proved path swap-free + TZ-stable after the input-index scare; 17-test parity harness | Governed Add/Deactivate (CRED-0001, APR-0012); **plain-ISO dates end-to-end as a type property** — the swap class is unrepresentable, byte-for-byte hosted-proven | **BETTER** (defect class removed by construction, not by test) |
| **Journeys** | Governed InitiateJourney (JRN-0021) + direct role-gated lifecycle (suspend/resume/complete/cancel, reason on cancel, invalid-transition refusal) | Same split (JRN-0001, APR-0013; hosted lifecycle run); + DB CHECK terminal/ended coherence + statement-level state machine + per-step audit actors | **BETTER** |
| **Kit** | Exemption-write lifecycle create/deactivate/transition + ETag 412 (kit Id 7/8) | Direct-audited CRUD, version-guarded, **changed-fields-only before/after audit images** (KIT-0001 hosted) | **SAME** core; **BETTER** audit; ⚠ one honest sub-gap: CP kit had status *transitions*; webv0 kit is active/inactive only — see §6 |
| **Apparel** | `upsertApparelProfile` per-person profile, HR edit rights (ACL) | Apparel **items register** assignable to persons; HR capability split server-enforced + hosted (APL-0001 by HR path certified in E2E; staging APL-0001) | **DIFFERENT-COVERED** — re-modeled from per-person profile to assignable inventory; create/edit/role-gating preserved and hosted-proven |
| **Mission participants** | Governed Add/Remove + **Set D guards**: dup-pending refused at submit; dup-active refused at submit AND execution (APR-0066 ExecFailed); reactivation reuses the same row (APR-0065) | Identical guard battery hosted-certified (S39: APR-0014..0016; `count(*)=1` across the lifecycle; both refusals witnessed; crafted-race test mirrors APR-0066) + **UNIQUE (tenant, mission, person)** making one-row-per-pair a database fact | **BETTER** (same certified semantics, constraint-backed) |
| **Mission shell** | V1 had **no in-product mission management** (Set C moved Operations to Missions **Read** after finding uncontrolled direct edit) | Direct-audited create/update/deactivate under a **deliberate** `canManageMissions` grant (owner/ops), version-guarded, hosted-certified (MSN-0001) | **BETTER** (net-new governed capability replacing an ACL accident) |
| **Approvals inbox** | Read + tabs + all approval ops (owner-only actions) | Register + detail + events timeline + all approval ops; capability-gated | **SAME** |

## 3. Identity, roles, and access

| Capability | CP | webv0 | Verdict |
|---|---|---|---|
| Role model | 7 roles from 6 SP site groups, exact-Title resolution, fail-closed to visitor | Same 7 roles from tenant membership, per-request resolution, fail-closed to unprovisioned/visitor | **SAME** set; **BETTER** substrate (real IdP below) |
| Identity | SharePoint site users (M365 coupling; group moves could force re-auth) | Entra ID PKCE; immutable (tid, oid) bind-once identity; B2B guests certified (E-1) | **BETTER** |
| Role certification | All four families hosted-certified on 1.0.0.8 (Owner, Ops 1E-C2, Management 1E-A/C1, Visitor 1E-B + Set E recert) | Owner + Operations hosted-certified through every sprint smoke; **all seven roles** rotated through a live identity in the A-4 drill (visitor/mgmt/hr/finance/legal surfaces certified) | **SAME** coverage |
| Least-privilege enforcement | Custom SP permission levels (Set C: Lifecycle Edit #1073741927, Op Add-Edit #1073741928), direct-endpoint 403 probes | Capability matrix in authz + per-route asserts + RLS FORCE beneath; 403s proven over HTTP per domain | **SAME** posture; **BETTER** depth (defense in DB, not list ACLs) |
| Visitor truthfulness (Set E) | Role-gated nav/hooks fail closed; no inert CTAs; per-diem/financial gating | Capability-gated nav + affordances; read-only roles see zero write affordances (E2E-asserted per domain); server 403 regardless of UI | **SAME** principle; contracts/per-diem surfaces themselves are deferred (§6) |
| Session revocation | N/A (SP session semantics) | A-7: per-request membership resolution — revocation effective next request, drilled live | **BETTER** (net-new) |
| Tenant isolation | N/A (single site) | A-1: RLS ENABLE+FORCE, hosted cross-tenant probes, second live org | **BETTER** (net-new) |

## 4. Audit and history

| Capability | CP | webv0 | Verdict |
|---|---|---|---|
| Governed-action history | C3Approvals rows + StatusNotes + list item versioning | `approval_event` + `audit_event` append-only streams, **DB-trigger enforced** (UPDATE/DELETE refused), before/after images restricted to changed fields | **BETTER** |
| Auth/access audit | None | SessionEstablished rows + platform `access_event` denial stream (A-8) | **BETTER** (net-new) |

## 5. Net-new capability (no CP counterpart — the "better" column earned)

Governed member administration (4 ops, A-4 hosted drill) · encrypted off-site daily backups + certified restore drill (2D, A-5) · org-scoped export + dual-authorized exit ceremony, hosted-exercised (B-5, E-1) · API rate limiting (F-1) · URL-routed SPA with deep links (CP: in-app state only, "no URL routes by construction") · OpenAPI-validated wire contract · multi-org operation on one deployment.

## 6. DEFERRED — the honest list (CP had it certified; webv0 does not yet)

| # | CP capability (evidence) | State in webv0 | Weight |
|---|---|---|---|
| D-1 | **Contracts domain, read-only**: register + truthful metrics, Contract Profile (canonical ID, person linkage, honest deferred tabs), Renewals center 30/60/90, GKE-PL-2026-001 canonical row (Phase 1 19.1/19.4) | **Absent** — no contracts tables/routes/pages | **The largest true gap.** CP itself was read-only V1 (writes N/A); parity requires the read surfaces + financial/per-diem role gating |
| D-2 | **Command Center work queue** (gaps/missions/milestones/participants aggregation, severity banding — 19.6 hosted) | Absent | Medium — aggregation over domains webv0 already has (except contracts-fed items) |
| D-3 | **Situation Room readiness cockpit** (+ kit facet strip; SG in CP, beta-certified surfaces) | Absent | Medium |
| D-4 | **Person Profile depth**: Missions section, Approvals tab (person-scoped history), Readiness tab | Partial — profile has credentials + journeys sections only | Small–medium |
| D-5 | **Operational Inbox** (renewal aggregation, metric cards) | Absent (contracts-dependent → follows D-1) | Rolled into D-1 |
| D-6 | **Settings screen** (owner-only; SG/UNV in CP — never hosted-certified) | Absent | Small; CP evidence was weakest here |
| D-7 | **Kit status transitions** (beyond active/inactive) | webv0 kit lifecycle = create/update/deactivate | Small; flag for owner: is the CP kit state machine still wanted, or is assignment+active sufficient? |
| D-8 | **Per-diem visibility gating** (canViewPerDiem surfaces in MissionWorkspace/ApprovalInbox) | No per-diem data model yet | Follows mission finance (itself deferred in CP — see below) |

**Not parity gaps (N/A-CP — excluded from the CP V1 certification itself, §12 of the inventory):** Amendments workspace (SP stub) · Intelligence workspace (cold-crash, hidden) · mission finance lines + milestones (SP stubs; Situation Room showed honest-unavailable) · Approve & Confirm Mission (TD-26, hidden) · document upload · capture-renewal write · legacy-migration tool. webv0 owes these nothing for parity; they are roadmap material on both sides.

## 7. Verdict

**The certified operational core of the CP is met or exceeded**: all six governed write chains, all four approval operations, rejection/failure/recovery semantics, both write-exemption families, the duplicate-participant guard battery, the seven-role model with fail-closed resolution, stale-write refusal, and truthful write feedback are **hosted-certified on webv0 with equal-or-stronger enforcement** — and the platform adds governed member administration, tenant isolation, revocation, append-only audit, backup/restore/export/exit lifecycle, and a real identity provider that the CP architecturally could not offer.

**The bar is NOT yet met for the read-aggregation layer**: the Contracts read-only domain (D-1) is the one certified CP domain with no webv0 counterpart, and the cockpit surfaces (D-2/D-3/D-4) that made the CP feel like an operations console are absent. **"Same or better" is therefore: ACHIEVED for every write/governance capability; OPEN for the contracts + cockpit read layer.**

**Recommended build order from this audit:** (1) **D-4** Person Profile depth — small, completes the person story; (2) **D-1** Contracts read-only domain — the material gap, one sprint-scale domain in the established pattern (reads + role gating, no writes, matching CP's own V1 posture); (3) **D-2/D-3** Command Center + Situation Room aggregations over the then-complete domain set. D-6/D-7/D-8 = owner-decision items, not defaults.

## 8. Claims note

This audit authorizes **no public claim**. In particular, "full CP parity" is **not claimable externally** while §6 is non-empty; the truthful internal statement is the §7 verdict, verbatim.
