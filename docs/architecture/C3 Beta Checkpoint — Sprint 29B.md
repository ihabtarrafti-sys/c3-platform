# C3 Beta Checkpoint — Sprint 29B

**Status:** ✅ **COMPLETE — hosted SP validation fully green (2026-07-03, final hardened runtime deployed; security 403 tests passed)**
**Date:** 2026-07-03
**Supersedes:** C3 Beta Checkpoint — Sprint 29A
**Head commits:** `0f8d9ce` (security/schema prep) · `a742eab` (services) · `0adbb63` (UI) · `6d33e22` (runtime)

Parts 0–15 of the S29A checkpoint carry over as regression items. Part 16 is new.
Hosted validation was executed against the deployed final runtime and passed in full.

---

## Part 16.0 — Schema + security deltas — ✅ applied and REST-verified (2026-07-03)

- [x] `C3Approvals.OperationType` choices: all 7 existing values preserved;
      `AddMissionParticipant` + `RemoveMissionParticipant` added (final set verified)
- [x] **`C3MissionParticipants` ACL** (unique role assignments = true, direct endpoint):
      Owners groups + acting admin = Full Control; **ALL other groups Read — including
      C3 Operations** (membership changes only through governed approvals); site Members
      Edit stripped; Legal FC stripped
- [x] **`C3Approvals` ACL** (unique = true): Owners FC; **C3 Operations = custom
      `C3 Approval Submitter`** (id 1073741926) — **Add-only after the hardening patch:
      EditListItems REMOVED** (view/open/add + REST bits only; NO edit, NO delete, NO
      manage/approve — bit-audited post-delta); all other groups Read; `WriteSecurity = 2`
      retained as defense-in-depth; owner lifecycle flows unaffected (FC/ManageLists)
- [x] **Immutable submission (hardening patch):** `createApproval` is a single requester
      POST (correlation Title, never parsed); ApprovalID derives from the SP item Id;
      legacy APR-XXXX Titles preserved; **submitted rows are immutable to their creator**
- [x] Before-state exported by principal ID prior to changes; site-level untouched
- [x] Acting operator verified `IsSiteAdmin`

**Practical security checks (pending role sessions — run in 16.2):**
- [x] Operations: submit a participant request — single POST succeeds; APR identifier
      returned/displayed correctly; **no Title MERGE attempted, no hidden 403**;
      pending-state detection finds the approval
- [x] Operations: direct REST MERGE of the requester's **own** approval row (Payload /
      ApprovalStatus / TargetPersonID / Title) → **every MERGE returns 403**
- [x] Operations: DELETE of own approval row → **403**
- [x] Operations: direct edit of a `C3MissionParticipants` row → **denied**
- [x] Operations: edit of ANOTHER user's `C3Approvals` row → **denied**
- [x] Owner: approve / reject / execute / recover → all succeed
- [x] **Regression:** an existing governed submission (AddCredential by Operations) still
      works end-to-end — the submitter level must not break AddPerson/AddCredential/
      DeactivateCredential/InitiateJourney submissions
- [x] Site Members cannot edit either list; C3 Legal has no edit/full-control bypass

## Part 16.1 — Pre-flight

- [x] HEAD at or after `1cba607` (immutable-approval hardening); pushed; SPPKG rebuilt/deployed
- [x] `verify:runtime` PASS (final S29B bundle SHA-256 `b29de64d1f976f4bbee090a9b98b42feb4e7078af284138fbfe9bac7c85fa6fd`)
- [x] All eight parity scripts pass (87/220/51/**55**/28/35/38/**34**, 0 failures)
- [x] **Add-only submitter mask verified live** (bit audit post-delta: EditListItems/
      DeleteListItems/ManageLists/ApproveItems/ManagePermissions all absent; reads+add intact;
      Operations bound; owners intact) — see the governance permissions note

## Part 16.2 — SP DSM hosted smoke: Add flow

- [x] As operations: Add Participant drawer — picker excludes active participants; submit →
      success toast with APR number; mission shows "addition pending approval" chip; the
      participant is NOT visible in the roster yet
- [x] Duplicate pending add for the same mission+person → blocked with the APR reference
- [x] As the SAME user who submitted: approve → **blocked (self-approval)**
- [x] As a second owner: approve → execute → participant appears in MissionWorkspace
- [x] Situation Room participant count updates; gap computation evaluates the new
      participant (ADR-002 live); Command Center derived work updates — with **no
      SituationRoom/CommandCenter code changes** (cache invalidation only)
- [x] No kit assignment is created automatically
- [x] ApprovalInbox summary reads "Add <Name> (PER-XXXX) to <MissionID> as <Role> …"

## Part 16.3 — Duplicate / recovery

- [x] Duplicate active add (approve+execute a second matching approval) → executes as
      already-applied; **no second participant row** (Title unique constraint is the
      final guard)
- [x] Conflicting add (same person, different role) → ExecutionFailed with the
      conflicting-row toast
- [x] Simulated stamp failure → re-execute repairs the stamp only (idempotent contract)
- [x] Historical inactive participant re-added → **same SP row reactivated** (verify in SP:
      one row, IsActive=true, fields refreshed) — no new row

## Part 16.4 — Remove flow

- [x] Remove dialog on a participant WITH active kit → submission blocked with the kit
      count and guidance; no approval row created
- [x] Deactivate the kit (S29A action) → removal now submits; pending-removal badge shows
- [x] Owner approves + executes → participant disappears from active reads; **SP row
      remains with IsActive=false**; StatusNotes/version history intact on kit rows
- [x] Re-execution after simulated stamp failure → already-inactive → stamp repaired
- [x] Mission gaps/work items recompute without the removed participant

## Part 16.5 — Regression

- [x] S29A kit/apparel writes remain green (owner + operations + hr roles)
- [x] AddPerson, AddCredential, DeactivateCredential, InitiateJourney submissions +
      executions green (approvals-list ACL must not have broken them)
- [x] Journey lifecycle, People, Missions, PersonProfile, Situation Room (TD-26 guard),
      Command Center green
- [x] Contracts/Amendments/Intelligence guards unchanged
- [x] No ErrorBoundary; no silent failures; no mapper warnings

### 16.6 Deferred (recorded)

- UpdateMissionParticipant, generic reactivation UI, kit metadata edits — deferred
- ~~C3Approvals own-row pre-approval tamper window~~ — **CLOSED by the immutable-submission
  hardening patch** (submitters are Add-only; no edit permission of any scope)
- [x] 16.2 addition: historical approvals still display their original APR identifiers
      (legacy Title passthrough) alongside new derived identifiers
- [ ] Site-wide permissions hardening — REMAINS an open owner decision (S29A finding)
