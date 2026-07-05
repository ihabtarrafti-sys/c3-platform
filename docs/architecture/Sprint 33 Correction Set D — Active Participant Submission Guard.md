# Sprint 33 Correction Set D — Active Participant Submission Guard

Date: 2026-07-05 · Deployed **1.0.0.7** (runtime `6f337e0b…`). HEAD advanced
`ae3bae8` → `bde5477`. Sessions: Owner = Ihab Tarrafti; Operations =
m.khalailah@geekay.com (#20, only in C3 Operations #12).

## 1. Exact defect cause
Hosted (Correction Set C, APR-0066): with an ACTIVE participant row for the
exact MissionID+PersonID pair, Operations could submit another
AddMissionParticipant approval with differing values. The submit guard was
**pending-only** (`assertNoPendingDuplicate`), so with no pending duplicate the
approval was created and only failed at execution
(`ParticipantConflictError`). The request was knowably impossible before
submission and should never have entered the approval queue.

## 2. Source correction
- **`utils/participantSubmissionGuard.ts`** (new, pure): `decideParticipantSubmission(rows)`
  → `allow-create` (0 rows) · `allow-reactivation` (1 inactive) · `refuse-active`
  (1 active) · `fail-integrity` (>1). Field-independent by construction (sees
  only activity states, so identical vs differing proposed values cannot change
  the outcome). Errors: `ParticipantAlreadyActiveError` (truthful, update-honest
  — differing role/external-code/per-diem are NOT an update; UpdateMissionParticipant
  deferred) and `ParticipantHistoryIntegrityError` (fail closed).
- **`IMissionService.getParticipantMembershipStates(missionId, personId)`**
  (narrowest interface extension): authoritative read of the EXACT canonical
  pair INCLUDING inactive rows. SharePoint adapter = `$select=IsActive` exact-pair
  GET with no active filter (absence proven, never inferred), **throws on read
  failure** so the guard fails closed. Mock adapter = store pair filter
  (all-active by mock semantics — removal deletes). Native fetch; no schema, no
  lookup column, no PnP, no direct mutation.
- **`useSubmitParticipantApproval.submitAdd`**: runs `assertSubmittableMembershipState`
  in BOTH DSM branches; in the SP branch AFTER the preserved
  `assertNoPendingDuplicate`. Canonical MissionID/PersonID pass verbatim. The
  inactive-row reactivation path is untouched. Execution-time checks
  (`already-applied` idempotency, `ParticipantConflictError`, reactivation)
  remain the authoritative race/concurrency boundary. Errors surface through the
  existing `toast.error` → hosted `NotificationRegion` path.

## 3. Active/inactive/multiple-row semantics
0 rows → allow; 1 inactive → allow reactivation; 1 active → refuse (identical OR
differing, no approval); >1 → fail closed. Pending-duplicate refusal preserved
and evaluated first. Distinct MissionID and distinct PersonID are independent
(different pair → 0 rows → allow).

## 4. Parity evidence
`scripts/s33-parity-participant-guard.mjs` — 21 checks (all 12 mandated
scenarios): pure decision over compiled source + REAL Mock adapter
(pair-exactness, distinct mission/person independence), plus static pins for the
SP exact-pair/no-active-filter/fail-closed read, hook ordering & both-branch
wiring, canonical-ID pass-through, preserved execution-time guards, and the
hosted feedback path. Wired into the gate.

## 5. Complete gate
PASS — 25 steps (20 parity incl. the new suite, both tsc, strict build,
verify:runtime, NUL audit).

## 6. Version and hashes
Solution **1.0.0.7**; runtime asset `6f337e0b77826ca056c25aa261cc7ed54a5154ee81697b0a25d2d5a3c6c8cf74`;
sppkg `c3ca61c10b1bfa14e0c5ecf056bd217dfb8c3cdeb80560f498ea44c755f6cece` (285,799 B);
host bundle `1e5c37f7` sha `e1b99a11…`; runtime chunk `bc00f880` sha `894eb74f…`.

## 7. Deployment evidence
One controlled tenant-wide Add(overwrite)+Deploy (Owner session): Add 200,
Deploy 200, catalog 1.0.0.6→**1.0.0.7 Deployed/Enabled/valid/"No errors."** No
retract, no per-site install. Live bytes re-fetched and hashed in-page: host
`e1b99a11…` (13,830 B), chunk `894eb74f…` — byte-match the package. Cold load
green (runtime-committed 32 ms, foreign tabster present, sandbox active, no
recovery, first modal open works).

## 8–11. Hosted acceptance
- **Reactivation control:** APR-0068 (Ops submit) — exactly one approval, Id 5
  inactive before execution and after approve-only; Owner execute → Id 5 active,
  same row, no second row (total 5).
- **Pending-duplicate:** second submit during the pending APR-0068 refused
  visibly ("already pending"), approval count unchanged.
- **Active-identical refusal:** with Id 5 active, identical resubmit refused with
  "…already an active participant on TR/2026/007 — no request was submitted…"; NO
  approval created.
- **Active-differing refusal:** differing role + external code refused the same
  way; NO approval created; participant row unchanged (IsActive true, ExternalCode
  CERT/S33/025R, role Coach).
- **Restore:** APR-0069 governed removal (Ops submit → Owner execute) → Id 5
  IsActive=false, same historical row, canonical unchanged, total 5. All approval
  rows preserved.

## 12. Approval-count reconciliation
49 → 51: +APR-0068 (AddMissionParticipant Executed) +APR-0069
(RemoveMissionParticipant Executed). **No approval exists for any of the three
refused attempts** (pending-duplicate, active-identical, active-differing).

## 13. Protected-record reconciliation
People 15, Contracts 1, Journeys 12, Missions 4, Participants 5 (Id 5 inactive),
Kit 8, Apparel 5 — unchanged. APR-0034/0045/0054 Submitted, APR-0066
ExecutionFailed — unchanged. GKE-PL-2026-001 (Id 49) unchanged. Correction Set C
ACL posture verified unchanged (Ops = C3 Lifecycle Edit / C3 Operational Add-Edit
/ Read / C3 Operational Add-Edit); requester approval PATCH & DELETE still 403.

## 14. Remaining defects
None from this correction. The submission guard now closes the last observed
gap. Prior owner observation (clean-ExecutionFailed has no in-UI re-execute;
resubmit is recovery) is unchanged and unrelated.

## 15. Read-only / visitor certification
No platform blocker remains — it requires only the explicit owner
group-membership change to seed a Read-only/Visitor identity. **Controlled beta
is not declared.**
