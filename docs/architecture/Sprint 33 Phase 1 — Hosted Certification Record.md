# Sprint 33 Phase 1 — Hosted Functional Certification Record

**Date:** 2026-07-05 · **Operator:** Owner session (Ihab Tarrafti, `C3 Platform Owners`, site admin)
**Deployed baseline:** solution **1.0.0.2**, runtime **`bb2ffba3…`** (loaded chunk `dc718d6c…` verified),
catalog Deployed/Enabled/no per-site. Repo HEAD = origin/master = `8561051`. Gate: **PASS**.

**Status:** Phase **1A COMPLETE** (read-only sweep, no mutation) · **1B COMPLETE** (read-only) ·
**1C/1D/1E BLOCKED** (accounts + fixtures + irreversible decision + render blocker — see §Blockers).

---

## RISK-0 (NEW, ELEVATED) — cold-load blank render on the deployed V1 build

On this session's cold loads, the C3 web part rendered **blank** (`mount-complete`, 0 DOM) via:
fresh cache-bust load, and a plain reload. It **rendered only after an edit-mode round-trip**
(the owner's "Edit → Cancel" warm-up), then subsequent view loads render fully (2271 chars).
This is TD-34 recurring on a **normal cold load hours after the last deploy** — i.e. not merely a
post-rapid-redeploy transient. **A plain reload does not recover it.** Console is clean (no error);
host reaches `mount-complete` but the runtime's React root commits zero DOM until the SPFx component
is warmed by an edit-mode instantiation.

**Impact:** every end user hits a blank page on first load and must know the Edit→Cancel trick.
This is the **top Controlled-Internal-Beta blocker candidate** and needs owner judgment on remedy
(accept workaround for a small internal cohort, vs a render-path code fix + one redeploy). The prior
TD-34 host hardening made `mount-complete` observable but did **not** fix the underlying first-mount
zero-commit. Side effect of the warm-up: page auto-republishes (version 3.0→4.0→5.0 this session;
content byte-preserved, checkout None — no data mutation).

## Phase 1A — hosted read-only certification matrix (all on 1.0.0.2)

| Surface | Result | Evidence (hosted, this session) |
|---|---|---|
| NavRail + role footer + DSM gating | **HG** | 10 items; **Amendments + Intelligence correctly hidden**; owner role |
| Command Center | **HG** | Operations Work Queue 17 items / 2 immediate; IMMEDIATE+HIGH bands; actions View Mission/Start Journey/Assign Owner; no false "All clear" |
| People | **HG** | Columns Person ID/Full Name/IGN/Role/Nationality/Status (no TotalContracts); 14 populated; Add Person present; cold-safe |
| Person Profile | **HG** | PER-0001; sections Contracts/Credentials/Missions/Readiness/Approvals/Apparel/Contract History populated (Apparel Jersey/Size; Missions RLCS); genuine contract listed; no crash |
| Contracts | **HG** | Contracts active; genuine row; metrics Total/Active/Renewing/Archived; **New Contract absent (TD-31)**; no crash |
| Contract Profile | **HG** | No "not found"; values match SP (Abdulaziz/Esports Agreement/Active/USD 500/2026-07-05→2027-07-01); rail highlighted |
| — Documents tab | **DFR (honest)** | "not yet available … document integration" |
| — Amendments tab | **HG (honest 0)** | "(0)" — C3Amendments list absent (404), shown as zero |
| — Activity tab | **RISK-3 minor** | "No activity yet" while `listContractActivities` returns `[]` (deferred schema) — inconsistent with Documents' honest "not yet available" |
| Renewals | **HG** | All-clear + tracking active contract; 30/60/90 windows; no error/crash |
| Missions | **HG** | 4 missions; Confirmed status; Kit; no crash |
| Situation Room | **HG** | Gaps cockpit: 24 Critical/7 High/0 Medium; Unrouted/Routed/Covered; mission Scope selector; **Approve & Confirm absent (TD-26 guard)**; no crash |
| Approvals | **HG** | Tabs Pending(2)/Approved(3)/Executed(29)/Rejected(1)/Failed(0)/**All(35)** — **reconciles exactly to the 35-row list** (complete queries, no truncation); Approve/Reject present |
| Inbox | **HG** | Renewal/contract items; no crash |
| Settings | **DFR (honest)** | "Settings coming soon … a future release" placeholder |
| Diagnostics | **HG** | Mode SharePoint; Adapter v1.0; **Read=Yes / Write=No**; Site URL |
| Cross-links | **HG** | Contract ↔ Person (both directions, Part 19.4); Situation Room gaps carry PER-/mission context |

**No mock-only data appeared in SP mode. No zero/missing value presented as readiness/success.**
Data integrity: all 9 list counts unchanged pre/post 1A; genuine row unchanged.

## RISK-1 — toasts disabled hosted → **SILENT governed-write feedback (PROVEN BLOCKER)**

Confirmed hosted: **zero Toaster elements in the DOM** (`C3Host` passes `disableToasts:true`; `App.tsx`
omits `<Toaster>`). Source review (2026-07-05) proves **every governed-write outcome is signalled only
via `toast.success`/`toast.error`**: submit success, approve, reject, **self-approval refusal,
execution success, execution FAILURE**, and recovery (ApprovalInbox ≈30 toast calls;
AddCredential/AddPerson/StartJourney/AddParticipant panels use toasts for success+error). The
`MessageBar` instances are static advisories ("approval may take time", recovery callout), **not**
outcome feedback.

→ In the hosted app, **all governed success/failure/refusal feedback is SILENT**. A user whose
execution fails, whose rejection fails, or who is denied self-approval sees **nothing**. This violates
the required "success and failure feedback is visible and understandable" and is a **Controlled-Beta
blocker** independent of accounts. Fix (bounded, preserves all locked constraints): surface governed
outcomes via an inline non-toast channel (MessageBar/status region) that works with the Toaster
disabled — or re-enable a hosted-safe Toaster. Requires a source correction + one versioned redeploy.

## Governed EXECUTION is not certifiable owner-only (identity-based self-approval guard)

`usePatchApprovalStatus` blocks review when `currentUser.loginName === approval.submittedBy`
(ADR-013: **ReviewedBy must differ from SubmittedBy**; ApprovalInbox surfaces "Self-approval not
permitted"). With **only the Owner identity existing**, every owner-submitted approval is
**un-approvable and un-executable**. Therefore, owner-only:
- **Certifiable:** submit (one approval row), requester-immutability, **self-approval refusal**
  (though the refusal is a suppressed toast — see RISK-1).
- **NOT certifiable:** owner review of another's submission, approve, reject-with-reason, and **all six
  execution branches** — and by extension the **authorized AddPerson test persona cannot be created**
  owner-only (AddPerson is itself governed).

→ Governed-write execution certification (1C), reject-with-reason, and the role matrix (1E) require
**exactly one distinct submitter identity** (a single dedicated test/service account operated by us is
sufficient — no external people). This is a hard technical requirement, not deferrable by "owner acts."

Narrow exception — **Phase 1D exemptions** (journey lifecycle, kit, apparel) are **direct** writes for
which the Owner holds ACL, so they are potentially owner-certifiable **if** a safe non-genuine fixture
(person + non-terminal test mission) is designated. No such fixture is currently identifiable
(the only clearly-informal mission "ewc rl" is Settled; personas unidentified; PER-0001 is genuine).

## RISK-2 — Situation Room finance/milestone truthfulness — **PASS**

Source-confirmed: `<FinanceSection>` renders only `financeLines.length > 0` (line 840) and
`<MilestoneSection>` only `milestones.length > 0` (line 849); the finance pill only when finance data
exists. With SP finance `[]` and the **C3MissionMilestones list absent (404)**, both sections are
**suppressed entirely** — never shown as false zero, complete, or ready. Hosted observation matches
(no finance/milestone markers even when mission-scoped). **No false operational state.**

## RISK-3 — Contract Profile Activity tab (minor)

`listContractActivities` returns `[]` (deferred schema) → Activity tab shows "No activity yet",
implying an empty-but-working audit trail rather than an unimplemented feature. Low severity (audit
timeline, not an operational/readiness falsehood). Fix candidate: match the Documents tab's honest
"not yet available" copy, or accept as documented deferred. **Not a hard blocker.**

## Phase 1B — role & fixture readiness (read-only)

**Group membership (hosted):**
| Group | Members |
|---|---|
| C3 Platform Owners | **Ihab Tarrafti** (owner) — available |
| C3 Operations | **empty** |
| C3 HR | **empty** |
| C3 Legal | **empty** |
| C3 Finance | **empty** |
| C3 Management | **empty** |

→ **Only the Owner identity exists.** No Operations submitter, no read-only role, no
HR/Legal/Finance/Management, no designated visitor. **1C and 1E cannot be certified** without accounts.

**Existing data / fixtures (hosted counts):** C3Contracts 1 (genuine), C3People 14, C3Credentials 18,
C3Journeys 11, C3Missions 4, C3Approvals 35, C3MissionParticipants 4, C3MissionKitAssignments 6,
C3PersonApparelProfiles 4. **C3MissionMilestones & C3Amendments lists do not exist (404).**

**Missions:** TR/2026/006 "RLCS 2026 – World Championship & EWC" (Confirmed, holds genuine PER-0001);
SATR/2026/003 "Saudi eLeague S2" (FinancePending); **TR/2026/007 "ewc rl" (Settled)** and
SATR/2026/004 "Saudi eLeague S3" (Canceled) — informal/terminal, not a safe Planning/Confirmed
write target. **No clearly-safe, non-genuine, non-terminal mission fixture for participant/kit writes.**
Test personas among the 14 people are not auto-identifiable (need owner designation). PER-0001
(Abdulaziz) is **genuine — must not be a destructive target.**

## Blockers (Phase 1 stop points hit)

1. **RISK-0 render blocker** — real hosted blocker requiring owner judgment (remedy decision).
2. **No submitter/role accounts** — 1C (governed writes: submit / self-approval refusal / requester
   immutability) and 1E (role matrix) blocked. Minimum to proceed: **1 Operations account** (submitter
   + exemptions), **1 read-only account** (Finance or Management), **1 no-C3-group/visitor** identity.
3. **No safe write fixtures confirmed** — need owner to designate/create a disposable **test person**,
   a **non-genuine test mission** (Planning/Confirmed), and confirm disposable credential/journey/kit
   targets. Do not invent a business Mission ID or silently create production-like data.
4. **AddPerson is irreversible** — needs explicit owner approval for a permanent certification persona
   or a documented one-time cleanup method before the AddPerson chain is executed.

## Certified so far vs pending

- **Hosted-green on V1 (read/render/nav):** all workspaces above, NavRail gating, Diagnostics
  (Write=No), Approvals completeness, TD-26/TD-31/TD-32 guards, cross-domain identity, RISK-2 PASS.
- **Pending hosted (blocked):** all 6 governed write chains, 4 approval operations, journey/kit/apparel
  exemptions, ETag/recovery drills, per-role matrix, RISK-1 write-feedback — all gated on accounts +
  fixtures + the RISK-0 decision.
