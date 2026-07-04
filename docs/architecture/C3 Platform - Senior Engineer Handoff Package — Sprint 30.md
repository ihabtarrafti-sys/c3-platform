# C3 Platform — Senior Engineer Handoff Package — Sprint 30

**Document type:** Authoritative technical memory — delta handoff for a fresh advanced-AI session
**Prepared:** 2026-07-04, from direct inspection of the current source tree (source wins over every older document)
**Supersedes:** the Sprint 29B handoff package **for everything stated here**; the S29B package
(`C3 Platform - Senior Engineer Handoff Package — Sprint 29B.md`) remains authoritative for
all unchanged detail (services, approval architecture, domain inventory, environment notes).
**Sprint state:** Sprint 30 CLOSED and hosted-green (2026-07-04) · Sprint 31 NOT started, direction not approved

---

## 1. Repository state at handoff

| Item | Value |
|---|---|
| Working copy | `C:\Projects\c3-fable` (branch `master`; Claude commits, the user pushes) |
| Closeout commit | `docs(s30): Close mission readiness cockpit sprint` (follows `f252704`) |
| Sprint 30 commit range | `79b7008` … closeout (7 sprint + 2 correction + 1 closeout commits on top of `1d06133`) |
| **Deployed runtime SHA-256** | `2a4a162dbfeda9411ccf9e9b12382a77f5c1d66c4291d99ff74eefcddfcf9be8` (hosted-verified) |
| Clean-tree expectation | tracked tree clean; `docs/fable/` and `docs/Handoff v2/` intentionally untracked |

**Validation gate (Sprint 30 shape — ALL required before any source commit):** nine parity
scripts — s15 87 · s16 220 · s17 51 · s18 55 · s27 28 · s28 35 · s29 38 · s29b 34 ·
**s30 59 (`scripts/s30-parity-readiness.mjs`, new)** — plus tsc ×2, MANDATORY strict build
(`npm run beta:runtime`), `npm run verify:runtime`, and the NUL/truncation audit.

**Git incident on record (2026-07-04, repaired):** the S29B closeout commits (`98bec97`,
`1d06133`) were orphaned by a pre-push reset; repaired by verified `--ff-only` merge. If
documented commits ever disappear from `git log`, check `git cat-file -t <sha>` for
dangling descendants before assuming loss.

## 2. What Sprint 30 added (delta over S29B)

### Mission Readiness Cockpit v1 (read-only; no new list/schema/screen)

- **Semantics (authoritative):** `Mission Readiness Semantics — Sprint 30.md`. Two-axis
  model: `MissionEvaluationState` (NotApplicable | NotEvaluated | Evaluated | Unknown) ×
  `MissionReadinessState` (Ready | Incomplete | AtRisk | Blocked; worst-wins precedence,
  Evaluated only). Planning/FinancePending → NotEvaluated; Settled/Canceled →
  NotApplicable. ADR-002 untouched — the cockpit computes BESIDE `useMissionGaps`.
- **Trust rule:** every source carries `{data, trusted}`; a failed query surfaces Unknown
  — never empty roster / NotRecorded / Clear. Pending approvals are informational only.
- **Facets:** participants (active executed; pending shown separately, never counted),
  compliance (exact useMissionGaps recipe; Critical→Blocked, High/Medium→AtRisk,
  NoParticipants≠Clear; journeys folded in as unroutedCount — NO separate journey facet),
  kit (participant-aware: Fulfilled requires ≥1 participant, all covered, all rows
  Delivered/Confirmed, no Missing; Missing→Exception→AtRisk, never Ready).
- **Files:** `types/missionReadiness.ts` (mission-specific — proven disjoint from
  `usePersonReadiness`; renamed from readiness.ts at review) ·
  `utils/missionReadiness.ts` (pure batch; protocols injected) ·
  `hooks/useMissionReadiness.ts` (EXISTING query keys only — zero new network surface) ·
  `components/shared/ReadinessFacetStrip.tsx` (rendered in MissionWorkspace cards outside
  the blocking isLoading; `showPendingChanges=false` there — S29B badges already show them).
- **Work item:** `MissionReadinessGap` (`mrg-{missionId}-participants`) — Confirmed/Active
  inside the 30-day window with zero active participants (previously invisible: MDP needs
  gaps, gaps need participants; mutually exclusive with MDP by construction).
  Operations/ProtocolDefault owner; StartDate due; ≤7d Immediate else High; Command Center
  routes "Assign Participants" to the Missions screen. Facet union extends to `'Kit'`
  without renaming — deliberately unused in v1.

### Security (platform-wide ACL hardening — COMPLETE for the operational core)

Eight lists now carry verified unique least-privilege ACLs. New in S30 (evidence:
`C3 Platform ACL Review — Sprint 30.md`): C3People + C3Credentials (Owners edit only),
C3Journeys (Owners + **Operations Edit** — S19 lifecycle runs in operator sessions),
C3Missions (Owners + **Operations Edit** — owner-confirmed manual authoring; the app has
ZERO mission write paths, TD-26 stubs intact). Site Members downgraded to Read; C3 Legal
FC removed; zero child scopes disturbed. **C3Contracts still inherits** — deferred to its
provisioning/activation decision (TD-28 residual). The rev 2 hardening method is LOCKED:
child-scope preflight, `clearSubscopes=false` always, programmatic posture verification,
direct-endpoint after-state, per-role hosted tests.

## 3. Intentional deferrals (primary lead architect — do NOT restore to v1)

Apparel facet + apparel batch read (`listAllApparelProfiles` does not exist; when built,
informational-only per the locked S28 rule). Kit-generated MissionReadinessGap items.
Also deferred: kit-not-applicable marker (schema), milestones/finance facets (SP services
are graceful stubs), overall percentage, per-participant readiness chips.

## 4. Guardrails (unchanged, all live)

Everything in S29B handoff §11 stands: source is ground truth; native fetch only, no
PnP.js; ADR-013 + two addenda locked; mission model frozen; plain-text canonical IDs; no
SP lookups; no SP numeric cross-domain identity; actual-ETag concurrency (`IF-MATCH: *`
prohibited in new code); Title never parsed; mock DSM = regression baseline; truthful
empty states; no silent mutation failures; hosted validation before closure; no
destructive provisioning; Contracts/Amendments/Intelligence + TD-26 guards intact.
New in S30: the trust rule (untrusted source ⇒ Unknown, never empty-success) is a locked
pattern for any future computed-aggregate surface.

## 5. Tech debt and risk state

**Resolved in S30:** TD-28 (core-list ACL bypass; C3Contracts residual open).
**Leading open risk:** TD-19 — approvals `$top=500` cap, monotonic growth; act before
~400 rows (server-side `targetPersonId` filter per TD-07 + pagination).
**Other open:** TD-23 (Intelligence cold-load), TD-26 (mission confirmation write design),
TD-14/15 (manual CI/CD + committed runtime), TD-22/C3Contracts, TD-24 (People Email),
UpdateMissionParticipant / generic reactivation UI / kit metadata edits, top-N
inconsistencies, s15–s17 inline parity migration, strict-gate automation.

## 6. Sprint 31 launch point (recorded candidates — owner decides at Phase 0)

1. **Approvals scale hardening + Readiness v1.1** (recommended): TD-19/TD-07 pagination
   and filtering; apparel facet + batch read; kit work-item facet. Low regression risk,
   burns the only monotonic operational risk.
2. **C3Contracts activation:** provisioning + ACL posture (rev 2 package applies) + guard
   removal + TD-22 legacy migration.
3. **TD-26:** governed mission-confirmation write design (ADR-013 operation vs documented
   exemption — explicit decision required).

## 7. First-day checklist for a new session

1. `git -C C:\Projects\c3-fable status` + `git log --oneline -15` — clean tree at/after
   the S30 closeout commit; two untracked doc dirs are expected.
2. Read: `C3 Architecture Baseline — Sprint 30.md`, `Sprint 30 Closeout Report.md`,
   `C3 Beta Checkpoint — Sprint 30.md`, `Mission Readiness Semantics — Sprint 30.md`,
   `C3 Platform ACL Review — Sprint 30.md`, `C3 Tech Debt Register.md`, this package,
   then the S29B package for unchanged architecture detail.
3. Run the complete nine-script gate — expect exactly the recorded totals.
4. Verify the deployed runtime SHA against §1.
5. Report discrepancies (code wins) before relying on any document.
6. Do not start Sprint 31 implementation without an approved Phase 0.
