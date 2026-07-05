# Sprint 33 Correction Set C — Credential Date Integrity, Least-Privilege ACL Hardening, Participant Reactivation

Date: 2026-07-05 · Environment: hosted, deployed **1.0.0.6** (runtime `1ff8c8d5…`,
UNCHANGED — no source correction required). Repo HEAD advanced by test/doc/ACL
records only. Sessions: Owner = Ihab Tarrafti; Operations = m.khalailah@geekay.com
(#20, only in C3 Operations #12).

## Finding A — credential dates: NOT a code defect

**Root cause: test-harness input-index artifact, not the product.** The entire
IssuedDate/ExpiryDate path maps both dates straight through with no transposition:

- AddCredentialPanel: `#acp-expiry` → `expiryDate` → `ExpiryDate`; `#acp-issued`
  → `issueDate` → `IssuedDate` (both `type="date"`).
- useSubmitCredentialApproval payload: `issuedDate: input.IssuedDate`,
  `expiryDate: input.ExpiryDate`.
- useExecuteApproval: `IssuedDate: payload.issuedDate`, `ExpiryDate:
  payload.expiryDate`.
- SharePointCredentialService write: `IssuedDate: input.IssuedDate`,
  `ExpiryDate: input.ExpiryDate`.
- spCredentialMapper read: `IssuedDate: issuedDate`, `ExpiryDate: expiryDate`
  via `normalizeSpDate` (`new Date(v).toISOString().split('T')[0]`).
- Person Profile: expiry via `credential.ExpiryDate`.

The Phase 1C CRED-0024 "transposition" was produced by the programmatic test
harness placing the two `type="date"` values into the wrong inputs during a
CDP-timeout retry, not by the code. CRED-0024 was NOT edited (preserved as
evidence with its artifact dates).

**Timezone:** no date shift. A bare `YYYY-MM-DD` posted to SharePoint on this
UTC-8 site is stored as `<date>T08:00:00Z`; `normalizeSpDate` reads the UTC date
back (`toISOString().split('T')[0]`) → same calendar date. Round-trip is stable
(also verified for `T00:00:00Z` and DST `T07:00:00Z` forms).

**Parity:** `scripts/s33-parity-credential-dates.mjs` (17 checks) — compiles the
real read-path normalizer and traces IssuedDate=2026-01-02 / ExpiryDate=
2031-12-30 through every hop, asserts no swap and no shift, plus static wiring
pins on all six source hops and Mock parity. Wired into the gate. Runtime bytes
UNCHANGED (`1ff8c8d5…`).

**Hosted proof (authoritative, filled by field ID):** CRED-0025 for PER-0025
via the full governed path (APR-0063, Ops submit → Owner approve → execute):
approval payload `{issuedDate:2026-01-02, expiryDate:2031-12-30}`; ApprovalInbox
summary "ISSUE DATE 2026-01-02 | EXPIRY DATE 2031-12-30"; SharePoint
`IssuedDate=2026-01-02T08:00:00Z`, `ExpiryDate=2031-12-30T08:00:00Z`; Person
Profile "Valid to 2031-12-30"; no timezone shift; exactly one credential
created (19→20); all other fields preserved. Then deactivated via governed path
(APR-0064) → inactive certification history. **No swap, no defect.**

## Finding B — ACL least-privilege hardening (REST, no deployment)

**Inspected first:** all four over-privileged lists had unique role assignments,
WriteSecurity=1, Operations (#12) holding built-in **Edit**. Web role
definitions enumerated; only "C3 Approval Submitter" existed as a custom level —
no exact match for the two needed postures.

**Created two narrowly-named custom permission levels** (derived from Contribute
by clearing bits; built-ins untouched):

| Level | Id | Perms (base = kind−1 bit) |
| --- | --- | --- |
| **C3 Lifecycle Edit** | 1073741927 | View, Edit + Open/OpenItems/Versions/FormPages/UseClientIntegration. NO Add, Delete, ManageLists, Approve, ManagePermissions. |
| **C3 Operational Add-Edit** | 1073741928 | View, Add, Edit + same supporting. NO Delete, ManageLists, Approve, ManagePermissions. |

**Reassigned (grant-before-remove), verified via direct endpoints:**

| List | Operations | HR |
| --- | --- | --- |
| C3Journeys | C3 Lifecycle Edit | Read |
| C3MissionKitAssignments | C3 Operational Add-Edit | Read |
| C3PersonApparelProfiles | C3 Operational Add-Edit | C3 Operational Add-Edit |
| C3Missions | **Read** (TD-26 deferred) | Read |

C3Approvals (Add-only submitter), and read-only C3People / C3Credentials /
C3MissionParticipants / C3Contracts were already correct and unchanged.
Owners / Platform Owners retain Full Control; other role groups retain Read.
Data and version history preserved (no list recreated, only role bindings
changed). No app operation was broken by the posture (regression below).

## Finding C — participant reactivation (governed)

Inactive participant row Id 5 (TR/2026/007 + PER-0025). Operations submitted
AddMissionParticipant (APR-0065) → exactly one pending, inactive row unchanged
pre-execution, canonical IDs in payload. Owner approved (row still inactive) →
executed → **row Id 5 reactivated** (IsActive=true, same row, no second row,
total still 5, canonical MissionID/PersonID unchanged). A new governed removal
(APR-0067) returned Id 5 to inactive historical state (row retained, total 5).

- **Duplicate-pending**: a second submit while APR-0065 pending was refused (no
  new approval; safe non-writing check).
- **Duplicate-active**: guarded at EXECUTION, not submit — a second submit
  (APR-0066, differing external code) was accepted at submit (submit guard is
  pending-only) but ExecutionFailed with `ParticipantConflictError` ("active row
  exists with DIFFERENT fields"); no second row, Id 5 unchanged. Finding
  recorded (see below).

## ACL hosted regression (as Operations, post-hardening)

Direct REST denials (all 403): C3People add/edit; C3Credentials add/edit;
C3MissionParticipants add/edit; C3Missions edit; C3Contracts delete (incl. GKE
Id 49); C3Journeys add + delete; C3MissionKitAssignments delete; apparel delete.
App-path successes: C3Approvals submission (APR-0064/65/67); approval PATCH &
DELETE still 403; journey lifecycle edit (JRN-0017 suspend→resume, restored, no
approval); kit create+edit+deactivate through C3 (disposable Id 8, retained
inactive); apparel edit+restore through C3 (PER-0025 profile, L→M→L). Corrected
effective base permissions for Operations now: Approvals V+A; People / Credentials
/ Participants / Contracts / Missions V-only; Journeys V+E; Kit & Apparel V+A+E;
ManageLists=0 and Delete=0 everywhere.

## Reconciliation (all deltas intentional durable fixtures)

Approvals 44→49 (APR-0063…0067, all preserved); Credentials 19→20 (CRED-0025,
inactive); Kit 7→8 (disposable Id 8, inactive); People 15, Journeys 12,
Participants 5, Apparel 5, Missions 4, Contracts 1 unchanged. Protected:
APR-0034/0045/0054/0055-0062 unchanged; GKE-PL-2026-001 unchanged; **CRED-0024
untouched** (still inactive, artifact dates intact). JRN-0017 restored to Active
(non-durable). No unexpected residue.

**Intentional durable fixtures:** PER-0025; CRED-0024 & CRED-0025 (inactive);
JRN-0021 (completed); apparel profile Id 5 (active, size L); participant Id 5
(inactive); kit Id 7 & Id 8 (inactive); approvals APR-0055…0067; JRN-0002
(cancelled, Phase 1C).

## Defects remaining / observations (owner decisions, not blockers)

1. **Clean-ExecutionFailed has no in-UI re-execute** (carried from Phase 1C) —
   resubmit is the operational recovery path for write-first operations.
2. **Duplicate-active participant is guarded at execution, not submit** — a
   duplicate-active submission is accepted (creating an approval) and only
   refused at execution via `ParticipantConflictError`. Consider adding an
   active-participant check at submit to fail earlier and avoid a spurious
   ExecutionFailed row. (Not a data-integrity risk: no second row is ever
   created; identical-payload resubmits are idempotent `already-applied`.)
3. No AddCredential defect — the Phase 1C observation was a harness artifact.

## Deployment

**None.** Finding A required no source correction (no defect), Finding B is
ACL-only via REST. The only source change is the test-only
`s33-parity-credential-dates.mjs`; runtime asset unchanged at `1ff8c8d5…`,
gate PASS (24 steps).

## Read-only / visitor role phase

**Not started** (as instructed). No platform blocker remains for it beyond the
explicit owner group-membership change it requires. **Controlled beta is not
declared.**
