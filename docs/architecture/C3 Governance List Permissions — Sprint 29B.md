# C3 Governance List Permissions — Sprint 29B

**Date:** 2026-07-03
**Status:** ✅ **APPLIED, REST-verified, and HOSTED-VERIFIED (2026-07-03)** — all practical
security checks passed on the deployed final runtime: Operations single-POST submission with
correct APR display; requester MERGE of Payload/ApprovalStatus/TargetPersonID/Title → 403;
requester DELETE → 403; direct participant-row edit denied; other-user approval edit denied;
owner approve/reject/execute/recover green; AddCredential regression green with no hidden
Title-backfill 403; legacy APR identifiers stable.
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

### Custom permission level: `C3 Approval Submitter` — **Add-only (S29B hardening patch)**

> **Approval submitters have Add-only operational access.**
> **Submitted approval rows are immutable to their creator** — immediately after
> submission, while Submitted/InReview, after owner approval, and before or after
> execution.

The original design carried `EditListItems` (constrained by `WriteSecurity=2`) because
`createApproval` used a POST-then-MERGE Title backfill. **The hardening patch eliminated
the MERGE**: `createApproval` now performs one requester-authorized POST with a
non-authoritative correlation Title (`APR-PENDING-<ts>-<rnd>`, never parsed as identity),
and the displayed APR-XXXX derives deterministically from the SharePoint item Id at read
time (`deriveApprovalTitle` in `spApprovalMapper.ts`). Legacy rows with authoritative
`Title = APR-XXXX` pass through unchanged — both schemes agree because the legacy MERGE
derived from the same item Id. Historical rows are not rewritten. SP numeric Id remains
internal same-list persistence/display derivation — never a cross-domain foreign key.

Final level (bit-audited after the ACL delta):

| Base permission | Included | Why |
|---|---|---|
| ViewListItems, ViewVersions | ✅ | read approvals + history |
| OpenItems, ViewPages, ViewFormPages, Open, BrowseUserInfo, UseRemoteAPIs, UseClientIntegration | ✅ | open the list/forms; REST access |
| AddListItems | ✅ | create approval rows — the ONLY write |
| **EditListItems** | ❌ **removed (hardening patch)** | no requester MERGE exists anymore |
| DeleteListItems | ❌ | approval rows are immutable audit |
| ManageLists, OverrideListBehaviors, ManagePermissions, ApproveItems | ❌ | admin surface |

`WriteSecurity = 2` is retained as defense-in-depth (harmless with no edit right; a
second fence if the level is ever widened by mistake).

**The previously accepted "own-row tamper window" residual risk is CLOSED** — submitters
hold no edit permission of any scope.

**Live verification (2026-07-03, post-delta bit audit):** role definition id 1073741926
MERGEd Low `200807 → 200803`, High `112` unchanged. Verified bits:
ViewListItems ✅ · AddListItems ✅ · **EditListItems ❌** · DeleteListItems ❌ ·
ApproveItems ❌ · ManageLists ❌ · ManagePermissions ❌ · OpenItems/ViewVersions/
ViewFormPages/Open/ViewPages ✅. C3 Operations remains bound to the level; Platform
Owners/site Owners Full Control intact; no other list ACLs touched. Practical 403 tests
(own-row MERGE of Payload/ApprovalStatus/TargetPersonID/Title; own-row DELETE) require an
Operations session — folded into Beta Checkpoint — Sprint 29B Part 16.2.

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
