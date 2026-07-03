# Sprint 29B Closeout Report — Governed Participant Membership
**C3 Platform**
**Sprint:** 29B — Governed Participant Membership (second half of the S29 governed-writes split) + Immutable Approval Submission hardening patch
**Closeout date:** 2026-07-03
**Status:** CLOSED — hosted SP validation fully green (incl. per-role security 403 tests)
**Preceding sprint:** Sprint 29A CLOSED (Kit & Apparel Lifecycle Writes)
**Validation baseline:** eight parity harnesses pass, tsc + strict build path clean, verify:runtime PASS, hosted green

---

## Closeout statement

Sprint 29B closes as:

> **"Mission membership is now governed operational truth. Operators submit
> AddMissionParticipant / RemoveMissionParticipant requests through C3; owners approve and
> execute; SharePoint rows are written safely with actual-ETag concurrency; removals retain
> history; re-adds reactivate the same retained row; every change is attributable through the
> C3Approvals trail; and mission gaps, counts, and work items refresh automatically. The
> approval submission channel itself was hardened: submitters have Add-only operational
> access and submitted approval rows are immutable to their creator."**

Sprint 29B does **not** close as:

> ~~"UpdateMissionParticipant, generic reactivation UI, or kit metadata editing exist (deferred)."~~
> ~~"Mission confirmation/status writes exist (TD-26 — deferred)."~~
> ~~"Participants can be physically deleted (never — IsActive=false only)."~~
> ~~"SituationRoom or CommandCenter were modified (cache invalidation only)."~~
> ~~"Site-wide ACL hardening happened (two governance lists only; the platform-wide review remains open)."~~

---

## What shipped

### Governed membership operations (full ADR-013 — locked classification)

| | AddMissionParticipant | RemoveMissionParticipant |
|---|---|---|
| Request | owner, operations (`canCreate`) | owner, operations |
| Approve | owner (self-approval blocked — existing check) | owner |
| Execute | owner session via `useExecuteApproval` | owner session |
| Validation | at submission AND authoritatively at execution (mission/person state, role union, ExternalCode normalized-required, per-diem finite/non-negative) | mandatory reason; active-row existence; **active-kit dependency re-checked at execution** |
| Duplicate protection | active-row check + **pending-request block** (one in-flight request per operationType+MissionID+PersonID across Submitted/InReview/Approved, validated in the submit flow) + Title unique constraint as the concurrent-create race guard | duplicate pending removal blocked |
| Result | POST / **governed reactivation** / already-applied / conflict / data-integrity | `IsActive=false` — never physical deletion; history retained |

### Participant identity and persistence

- Conceptual identity: **`MissionID + PersonID`** (one active row per person per mission).
- Deterministic `Title = <MissionID>|<PersonID>` exists **only** for SharePoint
  unique-value enforcement — never parsed as operational identity.
- SP item Id + ETag are internal persistence metadata only; **no SP lookup relationships;
  no SP numeric cross-domain identity**.
- Row resolution: exact compound-key columns, **including inactive rows** — 0 rows → POST
  (add) / RowNotFoundError (remove); 1 inactive → reactivation (add) / already-inactive
  recovery (remove); 1 active → exact-match already-applied vs ParticipantConflictError;
  **multiple rows → DataIntegrityError, no write**.
- All updates MERGE with the row's **actual ETag** — `IF-MATCH: *` does not appear in any
  S29-era write.

### Execution, recovery, and cache behaviour

- Execution order: parse/validate payload → authoritative state verification → participant
  write → stamp Executed → invalidate. Write failures stamp ExecutionFailed; partial
  (write-applied, stamp-failed) throws a named error; **recovery = re-execute** — the
  idempotent already-applied / already-inactive detection repairs only the stamp; no
  duplicate rows are possible (hosted-verified).
- Invalidation: `mission.participants(missionId)` **and** `mission.allParticipants()`
  (the dual-cache item designed in) plus `approvals.all()`. Situation Room gaps/counts and
  Command Center derived work refreshed through existing derived data — **no screen
  modifications** (hosted-verified). No kit assignment is auto-created.

### UX

Pending membership states (per-mission "addition(s) pending approval" chip; per-participant
"Removal pending approval" badge; chips are affordance — the submit hook validates
duplicates authoritatively). Kit-blocked removal dialog with mandatory reason and no
misleading success path. ApprovalInbox participant summaries with resolved names + safe ID
fallback, per-operation success toasts, and error toasts for conflict / kit-dependency /
partial cases.

### Immutable approval submission (hardening patch — `7b32fe6`)

Final creation model:

```
Requester POSTs the complete approval once
→ SharePoint returns item Id
→ mapper derives the public APR display identifier (deriveApprovalTitle)
→ no requester MERGE occurs
```

- The POST Title is a non-authoritative, collision-safe correlation value
  (`APR-PENDING-<ts>-<rnd>`) — **never used to locate or execute an approval**.
- Valid legacy `APR-XXXX` Titles remain accepted; correlation/blank/TMP Titles derive
  deterministically from the SP item Id — identifiers agree across both schemes (the legacy
  MERGE derived from the same Id), so **historical approval identifiers are stable** and no
  rows were rewritten. SP numeric Id is used only inside C3Approvals; the public
  `approvalId` shape is unchanged; owner lifecycle writes still address the exact SP item;
  recovery is fully compatible (hosted-verified incl. legacy display).

> **Approval submitters have Add-only operational access. Submitted approval rows are
> immutable to their creator.** The previously documented own-row tamper-window finding is
> **closed** (hosted-verified: requester MERGE of Payload/ApprovalStatus/TargetPersonID/
> Title → 403; requester DELETE → 403; AddCredential submission works with no hidden
> Title-backfill 403).

### Final ACL posture (live, REST-verified + hosted 403 tests)

- **`C3MissionParticipants`** — unique role assignments; Platform Owners/site Owners/admin
  = edit; **Operations and all other approved roles = Read** (membership changes only
  through governed requests); site Members and C3 Legal have no edit/FC bypass.
- **`C3Approvals`** — unique role assignments; Platform Owners retain full lifecycle
  control; requester roles use the custom **`C3 Approval Submitter`** level (minimum
  read/open/add; **EditListItems, DeleteListItems, ManageLists, ApproveItems,
  OverrideListBehaviors, ManagePermissions all excluded** — bit-audited); direct requester
  mutation denied; `WriteSecurity=2` retained as defense-in-depth.
- S29A logistics ACLs remain verified: `C3MissionKitAssignments` owner/operations edit;
  `C3PersonApparelProfiles` owner/operations/hr edit.

---

## Commit summary

`0f8d9ce` docs (security/schema prep) · `a742eab` feat (services) · `0adbb63` feat (UI) ·
`6d33e22` build · `b41442b` docs (checkpoint) · `7b32fe6` **fix (immutable submissions)** ·
`1cba607` build (final runtime) · `8f94cf2` docs (verified boundary) · *(this commit)*
docs closeout. Schema/ACL deltas applied live: OperationType +2 (7 existing preserved),
participants owners-only-edit, approvals submitter posture.

## Validation record

```text
s15: 87/87
s16: 220/220
s17: 51/51
s18: 55/55
s27: 28/28
s28: 35/35
s29A: 38/38
s29B: 34/34
tsc c3: clean
tsc c3-spfx-host: clean
strict build TypeScript path: clean
beta:runtime: pass
verify:runtime: pass
final runtime SHA-256:
b29de64d1f976f4bbee090a9b98b42feb4e7078af284138fbfe9bac7c85fa6fd
hosted SP validation: fully green
```

**Process note (mandatory going forward):** the plain `tsc --noEmit` gate missed build
failures twice in S29; the **strict build TypeScript path (`npm run beta:runtime`, which
runs `tsc -b`) is a mandatory part of the validation gate**, not an optional extra.

## Tech debt / deferred

- **TD-27 RESOLVED** — kit writes, apparel writes, and participant add/remove all complete
  and hosted-validated.
- Open: TD-26 (mission confirmation SP write), TD-19 (approvals top-500 volume),
  TD-23 (Intelligence cold-load containment), manual CI/CD + committed-runtime workflow,
  **platform-wide SharePoint ACL review** (operational lists beyond the four hardened ones
  still inherit site permissions — Members Edit / Legal FC exposure), deferred
  UpdateMissionParticipant / generic reactivation UI / kit metadata edits, top-N cap
  inconsistencies, s15–s17 inline parity pattern, strict-build-gate tooling improvement.

## Sprint 30 direction (recorded, not designed)

**Sprint 30 — Mission Readiness Cockpit** — preferred over immediate budgeting because the
platform now has live people, credentials, journeys, missions, participants, apparel, kit,
gaps, and governed operational updates: every facet the cockpit would display has real data
behind it.
