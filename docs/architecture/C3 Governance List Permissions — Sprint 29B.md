# C3 Governance List Permissions — Sprint 29B

**Date:** 2026-07-03
**Status:** Designed — applied and REST-verified during S29B provisioning (evidence appended at execution)
**Scope:** `C3MissionParticipants` + `C3Approvals` only. No site-wide rewrite.
**Relates to:** C3 Logistics List Permissions — Sprint 29A (method precedent) · C3Approvals SP List Schema §3.2

> UI role guards are UX controls. Service validation is application authority.
> **SharePoint ACLs are the security boundary.**

---

## 1. C3MissionParticipants — target posture

Membership is **full ADR-013 governed truth**: only the owner-executed approval flow may
write rows.

| Principal | Level | Rationale |
|---|---|---|
| C3 Platform Owners (19) + site Owners group (3) | Full Control | approval execution + admin |
| C3 Operations (12) | **Read** | submit requests through C3 — never direct row edits |
| C3 HR (13) / Legal (18) / Finance (15) / Management (17) | Read | app read surfaces |
| Site Visitors (4) / Members (5) | Read | preserves the app visitor-role read posture (S29A decision) |

Method: identical to S29A — export before-state by principal ID, verify acting admin,
`breakroleinheritance(copyroleassignments=false)`, explicit grants by ID with built-in
levels, direct-endpoint verification.

## 2. C3Approvals — target posture

The approvals list is the governance boundary for **all** ADR-013 operations. Requirements:

- **Platform Owners:** read, approve, reject, execute, recover stamps, update lifecycle
  fields → Full Control (site Owners group likewise).
- **Approved requester roles:** the live submitter population was inspected before design —
  every governed submission UI (AddPerson, AddCredential, DeactivateCredential,
  InitiateJourney, and the new participant operations) gates on `canCreate`, which only
  `owner` and `operations` hold. **C3 Operations is therefore the only non-owner requester
  principal.**
- Requesters must be able to **read** approval records (ApprovalInbox visibility,
  PersonProfile approval history) and **create** new approval rows — and, critically,
  **complete the POST-then-MERGE Title backfill on the row they just created**
  (`createApproval` derives APR-XXXX from the SP Id and MERGEs it back; verified in
  `SharePointApprovalsService.ts`). They must NOT edit other rows, change
  ApprovalStatus/SubmittedBy/stamps on others' rows, or delete anything.

### Custom permission level: `C3 Approval Submitter`

Built-in levels cannot express this (Contribute includes delete; Read cannot add). One
narrowly scoped custom level, combined with list-level **`WriteSecurity = 2`**
("create items and edit items that were created by the user"):

| Base permission | Included | Why |
|---|---|---|
| ViewListItems, ViewVersions | ✅ | read approvals + history |
| ViewPages, ViewFormPages, Open, BrowseUserInfo (if required by forms) | ✅ | open the list/forms |
| AddListItems | ✅ | create approval rows |
| **EditListItems** | ✅ **but constrained to OWN items by `WriteSecurity = 2`** | **required by the POST-then-MERGE APR-XXXX Title backfill** — excluding it (as originally sketched) would break every existing governed submission. Environment-verified deviation, not a guess. |
| DeleteListItems | ❌ | approval rows are immutable audit — never deletable by submitters |
| ManageLists, OverrideListBehaviors, ManagePermissions, ApproveItems | ❌ | admin surface |

**Accepted residual risk (documented):** with edit-own rights, a submitter could modify
their *own* approval row (e.g. Payload) after submission and before owner review. Mitigations:
the owner reviews the payload content at approval time; SP version history (versioning is
enabled on C3Approvals) records every change with the editor identity; execution re-validates
the payload authoritatively. Full immutability-after-submission would require an
event-receiver/Power-Automate lock — recorded as a future hardening item, out of S29B scope.

| Principal | Level |
|---|---|
| C3 Platform Owners (19) + site Owners (3) | Full Control |
| C3 Operations (12) | **C3 Approval Submitter** (custom) |
| HR / Legal / Finance / Management / Visitors / Members | Read |

`ReadSecurity` remains 1 (all items readable — the inbox and person histories read across
submitters).

## 3. Safety procedure (same as S29A)

Export current assignments by principal ID → verify `IsSiteAdmin` → break inheritance
without copy → explicit grants → **direct-endpoint** verification
(`HasUniqueRoleAssignments`, role assignments, `WriteSecurity`) → practical checks:
at least one Operations submission + owner approve/execute, plus a regression submission of
an existing governed operation (AddCredential). Practical checks requiring role sessions are
marked pending if unavailable, with REST evidence standing until Part 16 hosted validation.

## 4. Explicitly out of scope

Site-wide hardening (Members Edit / Legal FC on the remaining lists — People, Credentials,
Journeys, Missions, Contracts) remains a separate owner decision, unchanged from the S29A
finding.
