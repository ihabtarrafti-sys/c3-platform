# C3 Beta Operational Runbook
**C3 Contract Control Center**
**Status:** BETA — Sprint 22
**Last updated:** 2026-07-01
**See also:** C3 Beta Checkpoint — Sprint 21.md, C3 Error Library.md, C3 Tech Debt Register.md, ADR-013, ADR-013 Addendum — Journey Lifecycle Transitions.md

> **Purpose:** Day-to-day operator handbook for C3 beta use. Covers environment setup, runtime bundle deployment, daily operator workflow, error triage, and recovery procedures. This runbook complements — it does not replace — the Beta Checkpoint. The Beta Checkpoint is run episodically to validate feature correctness; this runbook is for ongoing operational use.

---

## 1. Purpose and Scope

**Audience:** Platform Owner operating C3 in the hosted-workbench beta environment.

**Covers:**
- First-time SP environment setup
- SP group / role verification
- Runtime bundle build, verify, and deploy workflow
- Daily approval queue and profile navigation workflow
- Error triage: how to identify and categorise an error
- Recovery procedures for all known failure modes
- Known beta limitations (quick reference)
- Pre-go-live requirements checklist

**Does not cover:**
- Feature-by-feature validation → see Beta Checkpoint (Sprint 21)
- Full go-live preparation → see TD register open items and S18 Beta Release Checklist Part 7
- Error definitions and technical detail → see C3 Error Library

---

## 2. SP Environment Setup (First-time)

### 2.1 Lists to provision

Provision the following SharePoint lists before first use. Each list must exist at the expected internal name with all required columns.

| List internal name | Schema reference | Minimum test data |
|-------------------|-----------------|-------------------|
| `C3People` | S16 C3People SP List Schema.md | At least one PER-XXXX person record |
| `C3Journeys` | S16 C3Journeys SP List Schema.md | None required; will be written by C3 |
| `C3Approvals` | S18 C3Approvals SP List Schema.md | None required; will be written by C3 |
| `C3Credentials` | S21 C3Credentials SP List Schema.md | None required; will be written by C3 |

Verify list accessibility before opening C3:
```
GET {siteUrl}/_api/web/lists/getbytitle('C3People')
GET {siteUrl}/_api/web/lists/getbytitle('C3Journeys')
GET {siteUrl}/_api/web/lists/getbytitle('C3Approvals')
GET {siteUrl}/_api/web/lists/getbytitle('C3Credentials')
```
Each must return HTTP 200. A 404 means the list was not provisioned; a 403 means permissions are missing.

### 2.2 Required C3Approvals columns

The `C3Approvals` list requires these columns (internal names):

| Column | Type | Notes |
|--------|------|-------|
| `Title` | Single line | APR-XXXX identifier (written by C3 via POST-then-MERGE) |
| `OperationType` | Choice | **Must include both `InitiateJourney` and `AddCredential`** |
| `TargetPersonID` | Single line | PER-XXXX of the subject person |
| `SubmittedBy` | Single line | loginName of submitting user |
| `SubmittedAt` | Date and Time | — |
| `ApprovalStatus` | Choice | Submitted, InReview, Approved, Rejected, Executed, ExecutionFailed |
| `ReviewedBy` | Single line | — |
| `ReviewedAt` | Date and Time | — |
| `RejectionReason` | Multi-line text | — |
| `ExecutedAt` | Date and Time | — |
| `ExecutionError` | Multi-line text | — |
| `Payload` | Multi-line text | JSON payload; do not manually edit |
| `Reason` | Multi-line text | — |

> If `OperationType` is missing `AddCredential`, credential approval submissions will fail with SP 400. See ERR-016 in the Error Library.

### 2.3 Required C3Credentials columns

| Column | Type | Notes |
|--------|------|-------|
| `Title` | Single line | CRED-XXXX identifier (written by C3 via POST-then-MERGE) |
| `HolderPersonID` | Single line | PER-XXXX of the credential holder |
| `CredentialType` | Choice | Must match `VALID_CREDENTIAL_TYPES` in the C3 package |
| `ReferenceNumber` | Single line | — |
| `IsActive` | Yes/No | Active status; set to Yes on creation |
| `IssuedBy` | Single line | Optional |
| `IssuedDate` | Date and Time | Optional |
| `ExpiryDate` | Date and Time | Optional |
| `ValidFromDate` | Date and Time | Optional |
| `SubType` | Single line | Optional |
| `Notes` | Multi-line text | Optional; used as lifecycle audit trail |
| `SupersedesCredentialID` | Single line | Optional |

### 2.4 SP security groups

C3 uses SharePoint security group membership to resolve the operator role at login. Groups must exist in the SP site before testing role-gated features.

| Group name | C3 role resolved | Permissions needed |
|-----------|-----------------|-------------------|
| `C3 Platform Owners` | `owner` | Read + Write on all C3 lists |
| `C3 Operations` | `operations` | Read + Write on all C3 lists |
| *(no matching group)* | `visitor` | Read-only on C3 lists |

Create groups in SP site settings → People and Groups → New Group. Add the appropriate test accounts to each group.

> If a user's role resolves incorrectly, verify group membership and `loginName`. See §3.3.

### 2.5 Minimum seed data

Create at least one person record in `C3People` with a `PersonID` in PER-XXXX format. The person must have no active Onboarding journey (so the full Submit → Approve → Execute flow can be tested).

---

## 3. SP Group and Role Verification

Before any beta session, confirm the current user resolves to the expected C3 role.

### 3.1 Checking the current role

1. Open the hosted workbench (`?dataSrc=sharepoint`).
2. Open DevTools → Console.
3. Look for a `[C3]` log entry showing `currentUser.loginName` and `currentUser.c3Role`.

Expected values:
- Platform Owner account: `c3Role: 'owner'` — Approvals inbox visible in NavRail; lifecycle action buttons visible.
- Operations account: `c3Role: 'operations'` — lifecycle buttons and Add Credential visible; no Approve/Reject/Execute in inbox.
- Non-C3-group account: `c3Role: 'visitor'` — no Approvals inbox; no lifecycle or Add Credential buttons.

### 3.2 If role is wrong

1. Verify the account is a member of the correct SP group (`C3 Platform Owners` for owner, `C3 Operations` for operations).
2. Verify `currentUser.loginName` is non-empty. If empty, see ERR-015.
3. Verify group names match exactly (case-sensitive). The role resolver uses `spRoleResolver.ts` which queries SP group membership by exact group name.
4. After correcting group membership, clear the browser session cache and reload the workbench.

### 3.3 loginName empty edge case

If `currentUser.loginName` is empty in the `[C3]` log, the role resolver fail-closes to `visitor` regardless of group membership. Causes: guest or external account that does not populate `pageContext.user.loginName` in SPFx. Use a standard member account for all beta testing. See ERR-015.

---

## 4. Runtime Bundle Build, Verify, and Deploy

### 4.1 When to rebuild

Rebuild the runtime bundle after **every source change** before any beta validation or hosted-workbench session. Do not skip; the hosted workbench loads the committed bundle file, not the local TypeScript source.

### 4.2 Build and verify sequence

```bash
npm run beta:runtime    # runs build:c3-runtime + copy:c3-runtime in sequence
npm run verify:runtime  # expects: PASS, both files exist, SHA-256 match
```

`verify:runtime` output on success:
```
[verify-runtime] dist: packages/c3-runtime/dist/c3-runtime.js ✓ (exists, non-empty)
[verify-runtime] host: packages/c3-spfx-host/src/webparts/c3Host/assets/c3-runtime/c3-runtime.js ✓ (exists, non-empty)
[verify-runtime] SHA-256: PASS ✓ (match)
```

If `verify:runtime` fails, see ERR-010 in the Error Library.

### 4.3 Commit the bundle

After a successful verify, check which tracked bundle files have changed:

```bash
git status
```

Stage and commit only the bundle files that appear modified:

```bash
git add packages/c3-spfx-host/src/webparts/c3Host/assets/c3-runtime/c3-runtime.js
# If the dist artifact is also tracked and appears modified in git status:
# git add packages/c3-runtime/dist/c3-runtime.js
git commit -m "build(...): Update SPFx runtime bundle"
```

> Do not blindly stage other files that appear modified in `git status` — sandbox filesystem artifacts may show spurious modifications to unrelated files.

### 4.4 Deploying to the SPFx app catalog

Upload the `.sppkg` from `sharepoint/solution/` to the SP tenant or site App Catalog. After upload, approve the API permissions if prompted. The C3 webpart uses the committed `c3-runtime.js` — no additional deployment step is needed for the runtime bundle.

---

## 5. Daily Operator Workflow

### 5.1 Opening C3

1. Navigate to the hosted workbench URL with `?dataSrc=sharepoint`.
2. Confirm `[C3]` console log shows expected `c3Role` (see §3).
3. Confirm People Workspace loads with person records visible.
4. Confirm Approvals inbox (shield icon) is visible in NavRail for owner/operations roles.

### 5.2 Submitting an approval (People Workspace → Person Profile)

1. Navigate to People Workspace; find a person with no active Onboarding journey.
2. Click through to the Person Profile → Readiness tab.
3. Click **Start Onboarding Journey** (or **Add Credential** from the Profile tab).
4. Fill in the form fields; click **Submit for Approval**.
5. Toast confirms submission. A `C3Approvals` row is created with `ApprovalStatus: Submitted`.
6. No `C3Journeys` or `C3Credentials` row is created at submission time.

### 5.3 Reviewing approvals (ApprovalInbox)

1. Navigate to the Approvals inbox (shield icon in NavRail).
2. The inbox shows tabs: Pending / Approved / Executed / Rejected / Failed / All.
3. For owner role: Approve and Reject buttons appear on Submitted/InReview cards.
4. For operations role: no Approve/Reject/Execute buttons — read-only inbox.
5. Self-approval is blocked: if `currentUser.loginName` matches `SubmittedBy`, the Approve button is disabled. Use a second account to approve your own submissions.

### 5.4 Executing an approved approval

1. In the Approved tab, find the approved card.
2. Click **Execute**.
   - For `InitiateJourney`: a `C3Journeys` row is created and the approval is stamped `Executed`.
   - For `AddCredential`: a `C3Credentials` row is created and the approval is stamped `Executed`.
3. Toast confirms execution. The card moves to the Executed tab.
4. If an active Onboarding journey already exists for the person (`InitiateJourney`), execution is blocked with a `DuplicateJourneyError` toast. See §6.1.
5. If the card shows a **Recover Execution Stamp** button instead of Execute, see §6.2.

### 5.5 Checking the PersonProfile Approvals tab

1. Navigate to any Person Profile → Approvals tab.
2. Active approvals (Submitted, InReview, Approved, ExecutionFailed) appear in the top section.
3. Terminal records (Executed, Rejected) appear in the History section.
4. The Approvals tab is **display-only**: no Approve, Reject, Execute, or Recover buttons appear here. All approval actions are taken from the ApprovalInbox.
5. Payload summaries show human-readable labels (e.g., "League Registration") — not raw JSON.

### 5.6 Quick SP verification queries

After execution, verify outcomes via SP REST:

```
# Check last approval status
GET {siteUrl}/_api/web/lists/getbytitle('C3Approvals')/items({id})?$select=ApprovalStatus,ExecutedAt,ExecutionError

# Check latest journey for a person
GET {siteUrl}/_api/web/lists/getbytitle('C3Journeys')/items?$filter=PersonID eq '{personId}'&$orderby=ID desc&$top=1

# Check latest credential for a person
GET {siteUrl}/_api/web/lists/getbytitle('C3Credentials')/items?$filter=HolderPersonID eq '{personId}'&$orderby=ID desc&$top=1

# Check for TMP-* orphan rows
GET {siteUrl}/_api/web/lists/getbytitle('C3Approvals')/items?$filter=startswith(Title,'TMP-')
GET {siteUrl}/_api/web/lists/getbytitle('C3Credentials')/items?$filter=startswith(Title,'TMP-')

# Last 5 approvals (queue overview)
GET {siteUrl}/_api/web/lists/getbytitle('C3Approvals')/items?$orderby=ID desc&$top=5&$select=Title,ApprovalStatus,OperationType,TargetPersonID,ExecutionError
```

---

## 6. Error Triage Process

### 6.1 Read the toast

Every C3 error surfaces a toast notification. The toast message maps directly to an entry in the Error Library.

| Toast text | Error Library entry |
|------------|---------------------|
| "Execution blocked — duplicate journey..." | ERR-001 |
| "Self-approval not permitted..." | ERR-002 |
| "Execution blocked — invalid payload..." | ERR-003 |
| "Partial execution — manual resolution required" | ERR-005 |
| "Partial execution — credential created..." | ERR-006 |
| *(no toast appears for any action)* | ERR-019 |

### 6.2 Check the browser console

Open DevTools → Console → filter `[C3]`. The error class name is logged alongside the toast message. Use the class name to find the exact Error Library entry and its recovery steps.

### 6.3 Inspect SP directly

For errors that appear to involve data inconsistency, use the SP REST queries in §5.6 to verify the current state of the relevant lists before taking any recovery action.

---

## 7. Recovery Procedures

### 7.1 DuplicateJourneyError — execution blocked, approval marked ExecutionFailed (ERR-001)

**What happened:** Execute was clicked on an `InitiateJourney` approval, but the target person already has an active Onboarding journey in `C3Journeys`. No `C3Journeys` row was created. The `C3Approvals` record is now `ExecutionFailed`.

**If the existing active journey is valid (the block was correct):**
1. No action needed on the approval. Inform the submitter that the journey was already active.
2. The `ExecutionFailed` record remains in the Failed tab as an audit record.

**If the existing active journey should be superseded:**
1. In SP, find the existing `C3Journeys` row for the person (`Status = Active`).
2. Set `Status = Closed` on that row.
3. Submit a new approval in C3 (the ExecutionFailed approval cannot be re-executed).
4. Execute the new approval; a new `C3Journeys` row will be created.

### 7.2 PayloadValidationError — approval remains Approved, nothing written (ERR-003)

**What happened:** The `Payload` column on the `C3Approvals` record is null, empty, or not valid JSON. Execution was blocked before any write occurred. The `C3Approvals` record remains `Approved`.

1. In SP, inspect the `Payload` column on the affected `C3Approvals` record.
2. If the JSON is recoverable (minor corruption), correct it in SP and try Execute again.
3. If not recoverable, submit a new approval from C3.
4. Do not manually edit `Payload` unless you understand the payload schema for the `OperationType`.

### 7.3 SelfApprovalError — cannot approve own submission (ERR-002)

**What happened:** The approving account has the same `loginName` as the submitting account.

1. Use a different account to approve the submission.
2. In single-operator beta (one account only): this is a known limitation. Accept and document that Approve was performed by the same user; this is only acceptable in a trusted single-operator beta environment.

### 7.4 PartialExecutionError — journey created, approval stamp failed (ERR-005)

**What happened:** Step 4 succeeded (a `C3Journeys` row was created and is `Active`); Step 5 failed (the `C3Approvals` stamp to `Executed` failed — network issue, SP 429, timeout). The `C3Approvals` record remains `Approved` with no `ExecutedAt`. The ApprovalInbox card shows a **Recover Execution Stamp** button.

**In-app recovery (preferred, if Recover button is visible):**
1. In the ApprovalInbox Approved tab, find the affected card.
2. Click **Recover Execution Stamp**.
3. The hook (`useRecoverExecutionStamp`) confirms the active journey exists, then stamps the approval `Executed` without creating a new journey row.
4. Toast: "Execution stamp recovered."

**Manual recovery (if Recover button is not visible):**
1. Confirm the `C3Journeys` row exists and has `Status = Active`:
   ```
   GET {siteUrl}/_api/web/lists/getbytitle('C3Journeys')/items?$filter=PersonID eq '{personId}' and Status eq 'Active'
   ```
2. In SP, update the `C3Approvals` record: set `ApprovalStatus = Executed` and `ExecutedAt = <ISO timestamp>`.
3. C3 UI reflects the corrected state on next polling cycle (~30s) or manual reload.

### 7.5 PartialCredentialExecutionError — credential created, approval stamp failed (ERR-006)

**What happened:** `C3Credentials` POST-then-MERGE succeeded (a new credential row exists); the `C3Approvals` stamp to `Executed` failed. The `C3Approvals` record remains `Approved`. The ApprovalInbox card may show a **Recover Execution Stamp** button.

**In-app recovery (if Recover button is visible):**
1. Click **Recover Execution Stamp** on the affected Approved card.
2. `useRecoverCredentialExecutionStamp` confirms the credential exists, then stamps the approval.

**Manual recovery (if Recover button is not visible — card state has shifted):**
1. Confirm the `C3Credentials` row exists:
   ```
   GET {siteUrl}/_api/web/lists/getbytitle('C3Credentials')/items?$filter=HolderPersonID eq '{personId}'&$orderby=ID desc&$top=1
   ```
2. In SP, update the `C3Approvals` record: set `ApprovalStatus = Executed` and `ExecutedAt = <ISO timestamp>`.

> **Caveat:** The credential recovery detector in the inbox may not trigger if the card has already transitioned out of the Approved state (e.g., due to a page reload or stale cache). Manual SP recovery is the fallback. See ERR-006 in the Error Library.

### 7.6 TMP-* orphan row (ERR-011)

**What happened:** A `C3Approvals` or `C3Credentials` row exists with a `Title` matching `TMP-<base36>`. The POST succeeded but the MERGE (which writes the canonical APR-XXXX or CRED-XXXX title) failed due to a network drop or SP 429.

1. Identify the orphan using:
   ```
   GET {siteUrl}/_api/web/lists/getbytitle('C3Approvals')/items?$filter=startswith(Title,'TMP-')
   GET {siteUrl}/_api/web/lists/getbytitle('C3Credentials')/items?$filter=startswith(Title,'TMP-')
   ```
2. Delete the TMP-* row(s) directly from SP (list item delete).
3. Re-submit the approval or credential operation from C3.

### 7.7 SP permissions or list missing (ERR-014)

**What happened:** A C3 list is inaccessible (404 or 403 on SP REST). C3 shows an error state or silent empty data.

1. Verify the list exists at the expected internal name.
2. Verify the current user has at least Read access on the list.
3. For write operations (owners, operations): verify Write access on the list.
4. Re-provision missing lists using the schema docs listed in §2.1.

### 7.8 Runtime bundle SHA mismatch (ERR-010)

**What happened:** `npm run verify:runtime` reports a SHA-256 mismatch or a missing file. The two copies of `c3-runtime.js` are out of sync.

1. Re-run `npm run beta:runtime` (build + copy in one step).
2. Re-run `npm run verify:runtime` and confirm PASS.
3. Stage and commit the updated bundle (§4.3).
4. If `verify:runtime` itself fails with a syntax error, the mnt filesystem may have truncated `scripts/verify-c3-runtime.mjs`. Restore with:
   ```bash
   git show HEAD:scripts/verify-c3-runtime.mjs > /tmp/restored_verify.mjs
   cp /tmp/restored_verify.mjs scripts/verify-c3-runtime.mjs
   ```

### 7.9 NUL byte in source file (ERR-012 — developer issue)

**What happened:** A source or doc file contains embedded NUL bytes (0x00), causing `tsc` or parity harness failures.

1. Identify the affected file:
   ```bash
   python3 -c "
   import sys, os
   for root, dirs, files in os.walk('packages/c3/src'):
       for f in files:
           path = os.path.join(root, f)
           d = open(path, 'rb').read()
           n = d.count(b'\x00')
           if n: print(path, n, 'NUL bytes')
   "
   ```
2. Restore from git: `git show HEAD:<path>` and write back via Python with UTF-8 encoding.
3. Re-run `tsc` and parity harnesses to confirm clean.

### 7.10 Git index corruption (ERR-013 — developer issue)

**What happened:** `git add` returns `error: bad signature 0x00000000 fatal: index file corrupt`.

```bash
export GIT_INDEX_FILE=/tmp/c3-git-index
git read-tree HEAD
git add <files>
git commit -m "..."
```

Keep `GIT_INDEX_FILE` set for all subsequent git operations in the same shell session.

---

## 8. Known Beta Limitations (Quick Reference)

| Symptom | Cause | Operator action |
|---------|-------|-----------------|
| Role resolves incorrectly | SP group membership missing or loginName empty | Check group membership and loginName (§3.2) |
| No toast appears for any action | FluentUI Toaster context issue (TD-16, ERR-019) | Check ToasterGuard; see ERR-019 |
| No deactivate credential button | `deactivateCredential` not implemented (TD-20) | Set `IsActive = No` directly in C3Credentials SP list |
| PersonProfile approval history truncated | `$top=500` + client-side filter (TD-19, ERR-017) | Not actionable in beta; monitor total C3Approvals count |
| No SuspendedAt / CancelledAt columns | Audit timestamps deferred (TD-21) | Use Notes column as manual audit trail |
| No background / batch execution | By design in beta | Execute approvals one at a time from ApprovalInbox |
| Executed/Rejected records not visible in old inbox tabs | Resolved in S20-P1: all tabs now shown | Upgrade from pre-S20-P1 build if needed |
| PersonProfile Approvals tab shows action buttons | This is a no-go condition (Beta Checkpoint Part 13) | Do not ship; file a bug |

---

## 9. Pre-go-live Requirements

The following must be resolved before C3 is deployed beyond a single-operator trusted beta environment. Tracked in the Tech Debt Register.

| # | Requirement | TD reference | Current state |
|---|-------------|-------------|---------------|
| **P1** | OData server-side filter on `listApprovals` by `targetPersonId` | TD-07, TD-19 | Workaround: client-side filter; truncates at 500 records |
| **P2** | Pagination support on SP list queries | TD-07, TD-19 | Not implemented |
| **P3** | CI/CD pipeline: tsc + parity + build:runtime | TD-14 | Manual only |
| **P4** | Bundle not committed to git (generate on deploy) | TD-15 | Manual dual-commit pattern |
| **P5** | Contracts/SP-02 implementation | TD-04 area | Deferred |
| **P6** | `deactivateCredential` implemented | TD-20 | Stub / not implemented |
| **P7** | Journey audit timestamp columns (SuspendedAt, CancelledAt, CompletedAt) | TD-21 | Deferred |
| **P8** | Full cross-person audit log | TD-12 (remaining gap) | Deferred post-beta |
| **P9** | Package versioning (all packages at 0.0.0) | TD-10 | Deferred to release |
| **P10** | License file | TD-17 | Missing |
| **P11** | `ObligationAssignmentsJSON` normalisation | TD-05 | Deferred |
| **P12** | PnP.js migration for ContractService | TD-04 | Deferred |
| **P13** | FluentUI Toaster root-cause fix | TD-16 | Workaround in place |
| **P14** | `getApproval` implementation | TD-06 | Throws if called |

Refer to `C3 Tech Debt Register.md` for severity, resolution path, and sprint attribution for each item.
