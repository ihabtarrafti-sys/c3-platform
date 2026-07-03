# C3 Beta Checkpoint — Sprint 29B

**Status:** Prepared — hosted validation PENDING S29B runtime deployment
**Date:** 2026-07-03
**Supersedes:** C3 Beta Checkpoint — Sprint 29A
**Head commits:** `0f8d9ce` (security/schema prep) · `a742eab` (services) · `0adbb63` (UI) · `6d33e22` (runtime)

Parts 0–15 of the S29A checkpoint carry over as regression items. Part 16 is new.
**Do not mark Sprint 29B closed until the runtime is deployed and Part 16 passes.**

---

## Part 16.0 — Schema + security deltas — ✅ applied and REST-verified (2026-07-03)

- [x] `C3Approvals.OperationType` choices: all 7 existing values preserved;
      `AddMissionParticipant` + `RemoveMissionParticipant` added (final set verified)
- [x] **`C3MissionParticipants` ACL** (unique role assignments = true, direct endpoint):
      Owners groups + acting admin = Full Control; **ALL other groups Read — including
      C3 Operations** (membership changes only through governed approvals); site Members
      Edit stripped; Legal FC stripped
- [x] **`C3Approvals` ACL** (unique = true): Owners FC; **C3 Operations = custom
      `C3 Approval Submitter`** (id 1073741926: ViewListItems/AddListItems/EditListItems/
      OpenItems/ViewVersions/ViewFormPages/Open/ViewPages + BrowseUserInfo/UseRemoteAPIs/
      UseClientIntegration; **NO DeleteListItems, NO ManageLists, NO ApproveItems** —
      bit-audited); all other groups Read; **`WriteSecurity = 2`** (edit own items only —
      constrains the submitter's EditListItems to their own rows; owners bypass via
      ManageLists so approve/reject/execute/stamp flows are unaffected)
- [x] Before-state exported by principal ID prior to changes; site-level untouched
- [x] Acting operator verified `IsSiteAdmin`

**Practical security checks (pending role sessions — run in 16.2):**
- [ ] Operations: submit a participant request (POST + APR Title backfill both succeed
      under the submitter level)
- [ ] Operations: direct edit of a `C3MissionParticipants` row → **denied**
- [ ] Operations: edit of ANOTHER user's `C3Approvals` row → **denied** (WriteSecurity=2)
- [ ] Owner: approve / reject / execute / recover → all succeed
- [ ] **Regression:** an existing governed submission (AddCredential by Operations) still
      works end-to-end — the submitter level must not break AddPerson/AddCredential/
      DeactivateCredential/InitiateJourney submissions
- [ ] Site Members cannot edit either list; C3 Legal has no edit/full-control bypass

## Part 16.1 — Pre-flight

- [ ] HEAD at or after `6d33e22`; pushed; SPPKG rebuilt/deployed
- [ ] `verify:runtime` PASS (S29B bundle SHA-256 `2665fb070a391bf52b615abf271d6bbde7d481fafda05c025b4bae23ece92d05`)
- [ ] All eight parity scripts pass (87/220/51/**47**/28/35/38/**34**, 0 failures)

## Part 16.2 — SP DSM hosted smoke: Add flow

- [ ] As operations: Add Participant drawer — picker excludes active participants; submit →
      success toast with APR number; mission shows "addition pending approval" chip; the
      participant is NOT visible in the roster yet
- [ ] Duplicate pending add for the same mission+person → blocked with the APR reference
- [ ] As the SAME user who submitted: approve → **blocked (self-approval)**
- [ ] As a second owner: approve → execute → participant appears in MissionWorkspace
- [ ] Situation Room participant count updates; gap computation evaluates the new
      participant (ADR-002 live); Command Center derived work updates — with **no
      SituationRoom/CommandCenter code changes** (cache invalidation only)
- [ ] No kit assignment is created automatically
- [ ] ApprovalInbox summary reads "Add <Name> (PER-XXXX) to <MissionID> as <Role> …"

## Part 16.3 — Duplicate / recovery

- [ ] Duplicate active add (approve+execute a second matching approval) → executes as
      already-applied; **no second participant row** (Title unique constraint is the
      final guard)
- [ ] Conflicting add (same person, different role) → ExecutionFailed with the
      conflicting-row toast
- [ ] Simulated stamp failure → re-execute repairs the stamp only (idempotent contract)
- [ ] Historical inactive participant re-added → **same SP row reactivated** (verify in SP:
      one row, IsActive=true, fields refreshed) — no new row

## Part 16.4 — Remove flow

- [ ] Remove dialog on a participant WITH active kit → submission blocked with the kit
      count and guidance; no approval row created
- [ ] Deactivate the kit (S29A action) → removal now submits; pending-removal badge shows
- [ ] Owner approves + executes → participant disappears from active reads; **SP row
      remains with IsActive=false**; StatusNotes/version history intact on kit rows
- [ ] Re-execution after simulated stamp failure → already-inactive → stamp repaired
- [ ] Mission gaps/work items recompute without the removed participant

## Part 16.5 — Regression

- [ ] S29A kit/apparel writes remain green (owner + operations + hr roles)
- [ ] AddPerson, AddCredential, DeactivateCredential, InitiateJourney submissions +
      executions green (approvals-list ACL must not have broken them)
- [ ] Journey lifecycle, People, Missions, PersonProfile, Situation Room (TD-26 guard),
      Command Center green
- [ ] Contracts/Amendments/Intelligence guards unchanged
- [ ] No ErrorBoundary; no silent failures; no mapper warnings

### 16.6 Deferred (recorded)

- UpdateMissionParticipant, generic reactivation UI, kit metadata edits — deferred
- C3Approvals own-row pre-approval tamper window — accepted residual risk (owner review +
  version history + execution re-validation); event-receiver lock = future hardening
- Site-wide permissions hardening — open owner decision (S29A finding)
