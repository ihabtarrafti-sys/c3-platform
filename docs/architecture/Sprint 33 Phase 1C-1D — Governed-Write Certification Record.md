# Sprint 33 Phase 1C–1D — Governed Writes, Exemptions, Recovery, and Owner/Operations Role Certification

Date: 2026-07-05 · Environment: hosted, deployed **1.0.0.6** (runtime `1ff8c8d5…`),
repo HEAD `e0c584b`, tracked tree clean (NO source changes required — no defects
demanded a code fix). Two authenticated sessions: **Owner** = Ihab Tarrafti
(reviewer/executor, site admin); **Operations** = m.khalailah@geekay.com (site
user Id 20, member of ONLY `C3 Operations` #12, not site-admin).

## Permanent synthetic persona

`PER-0025` — "C3 CERTIFICATION Persona S33 (Synthetic - Permanent)" (Id 25),
created through the full governed AddPerson chain. Permanent audit fixture.

## Approval ledger (all preserved as audit evidence — none recycled/deleted)

| APR | Operation | Result | Purpose |
| --- | --- | --- | --- |
| 0055 | AddPerson | Executed | Chain A → PER-0025 |
| 0056 | AddCredential | Executed | Chain B → CRED-0024 |
| 0057 | AddCredential | **Rejected** | Rejection drill (disposable duplicate) |
| 0058 | DeactivateCredential | Executed | Chain C → CRED-0024 inactive |
| 0059 | InitiateJourney | Executed | Chain D → JRN-0021 |
| 0060 | AddMissionParticipant | **ExecutionFailed** | Controlled transient-failure drill |
| 0061 | AddMissionParticipant | Executed | Chain E → participant Id 5 (operational recovery) |
| 0062 | RemoveMissionParticipant | Executed | Chain F → participant Id 5 IsActive=false |

Protected rows untouched: APR-0034, APR-0045 (legacy pending, unchanged
timestamps); APR-0054 (Set A certification row, item Id 54, still Submitted).
GKE-PL-2026-001 (contract Id 49) unchanged.

## Six ADR-013 governed chains

Every chain: Operations sees "Submit for Approval" (never direct create);
exactly one approval created; requester cannot approve/execute (no UI action
buttons) and cannot edit/delete the row (REST PATCH & DELETE → **403**);
approval alone performs no operational write (list count unchanged after
Approve); execution by Owner performs exactly one write and stamps ExecutedAt;
re-execution impossible (Execute affordance removed after Executed). Inline
hosted feedback (RISK-1 NotificationRegion) visible in BOTH sessions.

- **A AddPerson** → PER-0025, canonical PER identity, TargetPersonID stamped,
  People 14→15, no duplicate on re-execute.
- **B AddCredential** → CRED-0024 (HolderPersonID PER-0025, type Other, ref
  SYNTH-S33-0001, synthetic issuer, IsActive), Credentials 18→19, one row.
  (No submit-time or execution-time duplicate guard — deliberate per
  `useExecuteApproval.ts:32`, multiple same-type credentials are valid.)
- **C DeactivateCredential** → mandatory reason; approval doesn't deactivate
  before execution; execution flips ONLY CRED-0024 to IsActive=false; count
  stays 19 (no deletion).
- **D InitiateJourney** → JRN-0021 (PER-0025, Onboarding, Active); one journey;
  duplicate-active guard enforced at the UI (Start button suppressed once a
  journey exists).
- **E AddMissionParticipant** → participant Id 5 (MissionID `TR/2026/007`,
  PersonID `PER-0025` — canonical, never numeric Id), Participants 4→5, one
  active row, idempotent (Execute gone after success).
- **F RemoveMissionParticipant** → mandatory reason; kit-dependency blocker
  present while a kit was active, cleared once the kit was deactivated;
  execution sets IsActive=false (historical row retained, count stays 5).

## Rejection path

APR-0057 (disposable duplicate credential): mandatory rejection reason (Confirm
Reject disabled until reason entered); Owner rejected; no operational write
(Credentials stayed 19); requester visibility retained; audit reason stored;
row preserved.

## Execution failure & recovery

Controlled, reversible failure injection (fetch patched to 503 **only** on the
participant-create POST; approval-stamp and reads untouched). APR-0060 →
ExecutionFailed with truthful `ExecutionError` ("HTTP 503"), ExecutedAt EMPTY
(partial ≠ success), **no partial write** (participants stayed 4), inline
failure feedback visible. Patch removed → the **clean** ExecutionFailed has no
in-UI re-execute (the `useRecoverExecutionStamp` hook is scoped narrowly to the
InitiateJourney partial-stamp mode); operational recovery = requester resubmits
→ APR-0061 executed successfully (not blocked by the failed APR-0060, since it
is not pending). **Finding:** clean write-failure recovery is resubmit-only for
write-first operations; the narrow partial-stamp recovery hook remains
source/parity-green and was not induced hosted (would require failing only the
stamp step on a fresh journey — no spare synthetic journey slot).

## Journey lifecycle exemptions (no approval created for any)

- JRN-0021 (synthetic): **Suspend → Resume → Complete** — each a direct
  Operations action, zero approvals, transition menu correctly narrowed at each
  state (Suspended hides Complete; terminal state offers no transitions).
- JRN-0002 (existing safe test journey, PER-0002): **Cancel** with mandatory
  reason — authorized separate-journey use because a person may hold only one
  onboarding journey. (Durable authorized change to a test fixture.)

Valid-transition matrix enforced by button availability; invalid transitions
refused by omission. No approval record created for any exempt lifecycle action.

## Apparel exemption

Profile Id 5 (PER-0025, one active). Create (Apparel 4→5) and Edit (size L→XL)
both direct, no approval. **ETag:** normal edit advances ETag ,1→,2 (IF-MATCH,
never `*`); deliberately **stale ETag → 412**, fresh ETag → 204. The upsert
re-reads a fresh ETag immediately before MERGE (ADR-013-Addendum master-data
design), so a panel-level stale conflict resolves by re-read rather than a
user-facing banner — documented, not a defect. Final synthetic values restored
(L / CERT-S33).

## Mission kit lifecycle

Kit Id 7 (PER-0025 on TR/2026/007, Equipment, key CERT-S33-KIT-001). Created
only under a participant (prerequisite). Transitions
NotOrdered→Delivered→Confirmed→Returned via the status menu, which narrowed to
exactly the valid targets at each state (invalid refused by omission). Reason
mandatory and appended to the StatusNotes audit for Returned (Confirm disabled
until reason). StatusNotes carries `[ts] KITSTATUS old→new by <login> — reason`
audit lines. **Stale ETag → 412.** Deactivate with mandatory reason → IsActive
false, row retained (count stays 7, no physical deletion); inactive kit then no
longer blocked participant removal.
(Not re-tested hosted: duplicate-active-key kit creation — enforced by
AssignmentKey uniqueness in source/parity; the single kit was carried through
the full lifecycle instead.)

## Owner / Operations role matrix

Operations (verified): reads all intended workspaces; submits every governed
request; performs journey/kit/apparel exemptions; receives inline feedback;
**cannot** approve/reject/execute (no UI action buttons on any approval),
**cannot** edit/delete an approval row (REST 403), has **no Settings** nav
entry. Owner (verified): review, reject, approve, execute, and the
owner-authorized exemptions.

## Effective ACL (read-only, authoritative)

C3Approvals: HasUniqueRoleAssignments=true, WriteSecurity=2; C3 Operations →
custom **"C3 Approval Submitter"** role (View+Add only), Platform Owners &
Owners-shell & Ihab → Full Control, HR/Finance/Management/Legal/Members/Visitors
→ Read. Corrected current-user effective base permissions for Operations
(bit = PermissionKind−1):

| List | View | Add | Edit | Delete | Approve | ManageLists |
| --- | --- | --- | --- | --- | --- | --- |
| C3Approvals | ✓ | ✓ | — | — | — | — |
| C3People | ✓ | — | — | — | — | — |
| C3MissionParticipants | ✓ | — | — | — | — | — |
| C3Contracts | ✓ | — | — | — | — | — |
| C3Journeys | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| C3MissionKitAssignments | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| C3PersonApparelProfiles | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| C3Missions | ✓ | ✓ | ✓ | ✓ | — | ✓ |

**No list allows Operations to bypass governance:** the governed-write lists
(Approvals add-only; People & Participants read-only) force writes through the
owner-executed approval chain; the direct edit + ManageLists on
Journeys/Kit/Apparel/Missions is the *designed* ADR-013-Addendum exemption
surface, not a bypass. One item for owner awareness: Operations can directly
edit **C3Missions** master data (Edit+ManageLists) — consistent with operations
managing missions, but confirm this is intended.

## Reconciliation (before → after; all deltas intentional durable fixtures)

People 14→15 (PER-0025); Credentials 18→19 (CRED-0024, inactive); Journeys 11→12
(JRN-0021; JRN-0002 cancelled not deleted); MissionParticipants 4→5 (Id 5,
inactive); MissionKitAssignments 6→7 (Id 7, inactive); ApparelProfiles 4→5 (Id
5, active); Approvals 36→44 (APR-0055…0062, all preserved); Contracts 1 and
Missions 4 unchanged. No unexpected residue. Only genuine-data change:
JRN-0002 → Cancelled (authorized Cancel-exemption fixture).

## Defects / unverified

- No defect required a code fix; **no correction deployment required**.
- Observations (owner decisions, not blockers): (1) clean-ExecutionFailed
  write-failures have no in-UI re-execute (resubmit-only) — consider a bounded
  owner re-execute; (2) AddCredential Issue/Expiry dates stored transposed vs
  panel labels on the synthetic credential — verify field mapping; (3)
  Operations holds direct edit on C3Missions — confirm intended.
- Source/parity-green but not induced hosted: InitiateJourney partial-stamp
  recovery; duplicate-active-key kit creation; participant duplicate-pending
  guard (no simultaneous pending pair arose). Reasons documented above.

**Controlled Internal Beta readiness is NOT declared here.** The read-only and
visitor role slices remain pending an explicit owner group-membership change
(not performed this phase).
