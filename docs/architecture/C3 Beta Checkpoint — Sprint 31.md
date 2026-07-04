# C3 Beta Checkpoint — Sprint 31

**Sprint:** 31 — Approval Scale and Query Integrity
**Status:** Source complete · validation gate green · AWAITING index gate + deploy + hosted Part 18
**Prepared:** 2026-07-04
**Semantics:** `Approval Query Integrity — Sprint 31.md` (approved)

Sprint 31 is NOT closed until the index gate evidence is recorded and hosted
validation (Part 18) is fully green.

---

## Part 18.0 — Index gate (owner executes BEFORE deployment)

- [ ] Run the read-only index verification (`Approval Query Integrity — Sprint 31.md` §7)
      and record the output: **Title, ApprovalStatus, TargetPersonID, OperationType**
      must all show `Indexed: true`.
- [ ] If any index is missing: STOP, apply the non-destructive index-creation step for
      exactly the missing field(s), re-verify, record before/after. Alter nothing else.
- [ ] Capture live `ItemCount` and highest numeric Id (operational evidence).
- [ ] `git push origin master`; rebuild SPPKG; deploy; hard refresh; verify deployed
      runtime SHA-256 (final, post consumer-failure-state pass):
      `80df03b12c84214fbecce51754a1a1faffab3aa06896d8c9f8dfcc679f4a8032`

## Part 18.1 — Completeness (no omissions)

- [ ] Actionable counts: ApprovalInbox Pending/Approved/Failed tab counts equal direct
      SharePoint list-view counts filtered by the same statuses.
- [ ] An old **ExecutionFailed** approval (oldest available) is visible in the Failed
      tab with its recovery affordance — age is irrelevant.
- [ ] Person history: pick the person with the OLDEST approvals; the PersonProfile
      Approvals tab matches a direct `TargetPersonID` list-view filter — zero omissions.
- [ ] Pending participant requests: MissionWorkspace chips match a direct pending-band
      filter; submitting a duplicate participant request is refused
      (DuplicatePendingRequestError) — the guard does not fail open.

## Part 18.2 — Ordering and truthful windows

- [ ] Every inbox tab and the person history render in SharePoint numeric **Id
      descending** order (spot-check against list-view Id sort).
- [ ] Executed/Rejected tabs: if the terminal window is saturated, the "Showing latest
      N" banner renders and tab counts carry the `+` suffix; loaded counts are never
      presented as totals. (If under the window, counts display normally — truthful.)
- [ ] All tab shows the mixed-completeness disclosure line.

## Part 18.3 — Freshness and immediacy

- [ ] Newly submitted **person, credential, deactivation, and journey** approvals
      appear in the ApprovalInbox immediately after submission (no 30-second wait).
- [ ] Stale-tab refusal: open the same Approved card in two tabs; execute in tab 1;
      in tab 2, Execute/Reject is refused with a truthful live-status message —
      no duplicate operational write, no silent success.
- [ ] A 412 (if provoked by an out-of-band row edit between read and stamp) surfaces
      as a truthful concurrency message, and the recovery path appears as designed.

## Part 18.4 — Integrity and regression

- [ ] No approval row appears twice across merged tabs (spot-check All tab for
      duplicate APR ids).
- [ ] S29B participant governance regression green (add/remove/reactivate,
      pending chips, execution, recovery).
- [ ] Sprint 30 readiness strip regression green (pending indicators intact).
- [ ] Situation Room unchanged.
- [ ] NavRail guards and TD-26 confirmation guard unchanged.

## Part 18.5 — Consumer failure states (simulate via DevTools request blocking)

Block the C3Approvals `items` endpoint (DevTools → Network → block request URL
pattern) and hard-refresh the relevant screen; then unblock and verify recovery.

- [ ] **ApprovalInbox, actionable blocked:** explicit "Actionable approvals
      unavailable" error state; NO tab counts, NO empty-success ("no approvals") copy.
- [ ] **ApprovalInbox, terminal only blocked** (block after actionable loads, then
      switch tabs): Pending/Approved/Failed tabs keep their loaded rows and counts;
      Executed/Rejected tabs show "Terminal history unavailable" with `(—)` labels —
      never "No executed approvals"; the All tab lists actionable rows with the
      unavailability notice.
- [ ] **PersonProfile Approvals tab blocked:** error state renders — never
      "no approval history".
- [ ] **MissionWorkspace pending blocked:** cards show "Pending changes unavailable" —
      never an absent/no-pending signal; executed participant lists unaffected.
- [ ] **Readiness strip during pending failure:** overall/facets keep their trusted
      evidence-based states (locked S30 rule); no facet flips to Unknown from a
      pending-only failure.
- [ ] **Duplicate guard fail-closed:** with pending blocked, submitting a participant
      request is refused with the "submission blocked (fail-closed)" message —
      never accepted.
- [ ] ERR-036 documented behavior matches what renders (see C3 Error Library).

## Validation gate at source completion (2026-07-04)

| Check | Result |
|---|---|
| s15 / s16 / s17 / s18 | 87/87 · 220/220 · 51/51 · 55/55 |
| s27 / s28 / s29 / s29b / s30 | 28/28 · 35/35 · 38/38 · 34/34 · 59/59 |
| **s31 (new)** | **55/55** (40 core + 15 consumer failure-state checks) |
| tsc no-emit ×2 · strict build · verify:runtime · NUL audit | recorded at the build commit |

## Residual risk recorded

TD-29 — simultaneous two-session execution race (freshness+ETag prevents stale
SEQUENTIAL actions only). See the Tech Debt Register.
