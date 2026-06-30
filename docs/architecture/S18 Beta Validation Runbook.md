# Sprint 18 Beta Validation Runbook

**Status:** Active — applies to Phase 4B hosted-workbench build  
**Scope:** Governs approval governance loop (Submit → Approve → Execute)  
**See also:** ADR-013, S15/S16/S17 runbooks, `s18-parity-approvals.mjs`

---

## 1. Beta Scope and Caveats

This runbook covers the Sprint 18 governance approval loop as deployed to the SharePoint hosted-workbench. The following are known beta limitations that **must be resolved before go-live**.

| Caveat | Detail | Resolution path |
|--------|--------|-----------------|
| **Role stub** | `c3Role` is hardcoded `'owner'` in `SharePointHost.tsx`. All authenticated users see the Approvals screen and can Approve/Reject/Execute. | Replace with real SP security-group membership lookup (future sprint). |
| **Self-approval reliance on loginName** | ADR-013 self-approval block compares `currentUser.loginName` to `approval.submittedBy`. In beta, if `loginName` is empty (edge case), the guard is skipped silently. | Ensure `pageContext.user.loginName` is always populated by SPFx. Verify in live DSM. |
| **Manual runtime bundle commit** | The SPFx bundle (`packages/c3-spfx-host/dist/`) is not built by CI. After any code change, run `npm --workspace packages/c3 run build:runtime` and commit the bundle manually before hosted-workbench validation. | Wire up CI bundle build (future sprint). |
| **Sequence race on journey IDs** | `SharePointJourneyService.initiateJourney` derives the JRN-XXXX sequence by fetching the last list item and incrementing. Concurrent submissions from two sessions could collide. SP will accept both (no unique constraint), producing duplicate IDs. | Add SP column unique constraint or server-side sequence (future sprint). |
| **No background or batch execution** | Approvals are executed one at a time via the Execute button in the UI. There is no background runner, scheduler, or bulk execution path. | Intentional for beta. Document expected operator workflow. |
| **No Executed/Rejected filter in inbox** | The Approvals inbox only shows Submitted, InReview, and Approved items. Executed and Rejected records are not visible in the UI. | Query the C3Approvals list directly in SharePoint for audit. |

---

## 2. SharePoint List Prerequisites

Before running any validation, confirm the following lists exist and are provisioned with the correct columns. Refer to the SP List Schema documents for exact column definitions.

- **C3People** — `S16 C3People SP List Schema.md`
- **C3Journeys** — `S16 C3Journeys SP List Schema.md`
- **C3Approvals** — `S18 C3Approvals SP List Schema.md`

Minimum test data: at least one person record in C3People with a PER-XXXX PersonID that has no active Onboarding journey.

---

## 3. DSM Test Flow: Submit → Approve → Execute

### 3.1 Submit a Journey Approval

1. Open the hosted workbench (`?dataSrc=sharepoint` or equivalent).
2. Navigate to the **People** screen.
3. Select a person with no active Onboarding journey.
4. Click **Start Onboarding Journey** (or equivalent trigger in PersonProfile).
5. Fill in the initiation form — provide `initiationReason` and `assignedTo`.
6. Submit.

**Expected outcomes:**
- A toast appears: "Approval submitted" (or equivalent from the submitting screen).
- A new row appears in C3Approvals with `ApprovalStatus = Submitted`.
- No row is created in C3Journeys.

**Verify via SP:**
```
GET {siteUrl}/_api/web/lists/getbytitle('C3Approvals')/items?$filter=ApprovalStatus eq 'Submitted'&$orderby=ID desc&$top=1
```

### 3.2 Approve the Submission

1. Navigate to the **Approvals** screen (shield icon in NavRail).
2. The submitted record appears with status badge **Submitted** (orange).
3. *(If you are the same user who submitted: the Approve button should be blocked by SelfApprovalError. Use a second account or note the beta limitation.)*
4. Click **Approve**.
5. Toast: "Approval approved — [title] has been approved."

**Expected outcomes:**
- C3Approvals row: `ApprovalStatus = Approved`, `ReviewedBy = <loginName>`.
- Inbox badge updates to show **Approved** (purple) on the card.
- Card action area changes from Approve/Reject buttons to **Execute** button.

**Verify via SP:**
```
GET {siteUrl}/_api/web/lists/getbytitle('C3Approvals')/items({id})?$select=ApprovalStatus,ReviewedBy
```

### 3.3 Execute the Approved Approval

1. On the Approved card in the Approvals inbox, click **Execute**.
2. Button shows "Executing…" while the operation runs.
3. Toast: "Approval executed — [title] — Journey created for [personId]."

**Expected outcomes (SP):**

C3Approvals:
- `ApprovalStatus = Executed`
- `ExecutedAt = <ISO timestamp>`
- `ExecutionError = null`

C3Journeys — new row:
- `Title = JRN-XXXX` (next in sequence)
- `PersonID = <target personId>`
- `JourneyType = Onboarding`
- `Status = Active`
- `InitiatedBy = <loginName from payload>`
- `InitiatedAt = <ISO timestamp>`
- `AssignedTo = <value from payload>`

**Verify C3Approvals:**
```
GET {siteUrl}/_api/web/lists/getbytitle('C3Approvals')/items({id})?$select=ApprovalStatus,ExecutedAt,ExecutionError
```

**Verify C3Journeys:**
```
GET {siteUrl}/_api/web/lists/getbytitle('C3Journeys')/items?$filter=PersonID eq '{personId}'&$orderby=ID desc&$top=1
```

---

## 4. Negative-path Tests

### 4.1 Duplicate execution block

1. Ensure the person already has an `Active` Onboarding journey in C3Journeys.
2. Attempt to Execute an Approved approval for the same person.

**Expected:** Toast "Execution blocked — duplicate journey". C3Approvals row updated to `ExecutionFailed` with error message. No new C3Journeys row created.

### 4.2 Self-approval block

1. Submit an approval as User A.
2. Stay as User A and attempt to Approve the record.

**Expected:** Toast "Self-approval not permitted". C3Approvals status unchanged (remains Submitted/InReview).

### 4.3 Reject path

1. With a Submitted record visible, click **Reject**.
2. Enter a rejection reason and click **Confirm Reject**.

**Expected:** Toast "Approval rejected". C3Approvals: `ApprovalStatus = Rejected`, `RejectionReason = <text>`. Card moves to read-only (no action buttons).

---

## 5. Error Recovery

### 5.1 ExecutionFailed — duplicate

The C3Approvals record is stamped `ExecutionFailed`. The operator can:
1. Investigate the existing active journey in C3Journeys.
2. If the existing journey should be superseded, manually close it in SharePoint (`Status = Closed`), then re-create a new Approval and execute.
3. If the ExecutionFailed record should be cleared, update `ApprovalStatus` directly in SharePoint.

### 5.2 PartialExecutionError (rare)

A journey row was created in C3Journeys but the approval stamp to `Executed` failed. The UI shows: "Partial execution — manual resolution required."

Recovery:
1. Confirm the C3Journeys row exists and has `Status = Active`.
2. In SharePoint, manually update the C3Approvals row: set `ApprovalStatus = Executed` and `ExecutedAt = <timestamp>`.
3. The C3 UI will reflect the corrected state on next refresh (30-second polling or manual page reload).

### 5.3 Payload validation failure

C3Approvals record has a malformed or missing `Payload` column. The UI shows: "Execution blocked — invalid payload."

Recovery:
1. In SharePoint, inspect the `Payload` column of the C3Approvals record.
2. If the JSON is corrupt, manually correct or re-submit a new approval.
3. No journey was created; the approval status is unchanged (remains Approved).

---

## 6. Automated Parity Checks

Run these before any commit:

```bash
node scripts/s18-parity-approvals.mjs
node scripts/s17-parity-journeys.mjs
node scripts/s15-parity-test.mjs
node scripts/s16-parity-people.mjs
npx tsc --noEmit -p packages/c3/tsconfig.json
npx tsc --noEmit -p packages/c3-spfx-host/tsconfig.json
```

All must pass. NUL byte audit on modified files:

```bash
python3 -c "
import sys, os
files = [
  'packages/c3/src/screens/ApprovalInbox.tsx',
  'packages/c3/src/hooks/useExecuteApproval.ts',
  'packages/c3/src/hooks/usePatchApprovalStatus.ts',
  'packages/c3/src/hosts/SharePointHost.tsx',
]
for f in files:
    d = open(f, 'rb').read()
    nul = d.count(b'\x00')
    print(f'{f}: {nul} NUL bytes' + (' ⚠' if nul else ' ✓'))
"
```

Runtime bundle (must not be staged unless explicitly updating it):

```bash
git diff --name-only --staged | grep c3-spfx-host/dist
```

---

## 7. Pre-Go-Live Checklist (not beta scope)

- [ ] Replace `c3Role: 'owner'` stub with real SP group membership lookup
- [ ] Add CI pipeline step to build SPFx bundle on merge to main
- [ ] Add unique constraint or server-side sequence for JRN-XXXX IDs
- [ ] Provision production C3Approvals, C3Journeys, C3People lists with correct permissions
- [ ] Configure SP list permissions: only owners can write to C3Approvals and C3Journeys
- [ ] End-to-end test with two distinct AAD accounts (submitter ≠ approver)
- [ ] Confirm `pageContext.user.loginName` is non-empty for all user types (guests, externals)
