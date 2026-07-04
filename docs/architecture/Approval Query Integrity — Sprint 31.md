# Approval Query Integrity — Sprint 31

**Status:** Approved (owner decision, 2026-07-04) — implemented in Sprint 31
**Scope:** Approval Scale and Query Integrity — no approval lifecycle redesign
**Harness:** `scripts/s31-parity-approval-queries.mjs` (compiled-from-source)

---

## 1. Problem (Phase 0 findings)

Every approval read funnelled through one `listApprovals` call with a hard `$top=500`,
no pagination, and `$orderby=SubmittedAt desc` — a non-indexed, CLIENT-clock-stamped
column. Consequences: person history silently truncated (TD-19); stuck Approved /
ExecutionFailed rows older than the newest 500 vanish from the inbox (recovery
invisibility); the duplicate-pending guard fails OPEN past 500 pending-band rows; and
the non-indexed ordering becomes a hard 5,000-item threshold outage. Three of four
legacy submit hooks never invalidated the approvals cache. Execution/review/recovery
guards read the CACHED card status; `getApproval` was a throwing stub (TD-06).

## 2. Approved query classes

| Class | Statuses | Completeness | Consumers |
|---|---|---|---|
| **Pending** | Submitted, InReview, Approved | complete (exhaustively paged) | participant duplicate guard; MissionWorkspace pending chips; readiness pending inputs |
| **Actionable** | Pending + **ExecutionFailed** | complete — ExecutionFailed is actionable recovery state, never windowed | ApprovalInbox pending/approved/failed tabs + counts |
| **By person** | all 6 | complete, server-filtered `TargetPersonID` (indexed), OData-literal-escaped | PersonProfile approval history |
| **Terminal recent** | Executed, Rejected | deliberate window (latest N by Id) — UI MUST say "Showing latest N"; loaded counts are never presented as totals | ApprovalInbox executed/rejected tabs |
| **Single row** | any | fresh `items(Id)` read returning the row + its current ETag | execution / review / recovery freshness preconditions |

The All tab discloses mixed completeness: all actionable + recent terminal history.

## 3. SharePoint query rules (locked)

1. Authoritative ordering is **`Id desc`** — the SP numeric Id is monotonic, unique,
   indexed by nature, and already the source of APR identity. `SubmittedAt` is
   client-clock data: display only, never paging or authoritative order.
2. Separate **single-status indexed queries** (no multi-value OR filters); results are
   merged, **deduplicated by numeric Id (fresher fetch wins)**, and sorted Id desc.
3. Complete queries follow `odata.nextLink` to exhaustion. Every followed link is
   validated as a same-origin `/_api/` SharePoint URL before use.
4. AbortSignal propagates through every page request. Cancellation surfaces as an
   AbortError — distinguishable from failure, never an empty successful result.
5. **Fail closed:** any failed, malformed, or untrusted page rejects the whole call.
   A partial page assembly is never returned as a successful complete result.
6. **Query integrity (clarification 1):** on a complete query, ANY mapper-rejected row
   raises `ApprovalQueryIntegrityError` carrying the rejected item IDs — a rejection
   never produces a silent partial success.
7. Title / public APR display identity is never parsed for persistence identity —
   `getApproval` addresses the retained SP numeric item Id.

## 4. Freshness and ETag rule (clarification 2)

Execution, review (approve/reject), and stamp-recovery actions perform a fresh
`getApproval(id)` read first; the **fresh row** — not the cached card — drives the
status precondition, and the **fresh row's ETag** is used as `IF-MATCH` for the
subsequent MERGE. No new `IF-MATCH: *`; the cached card's data is never the update
precondition. This prevents stale sequential actions; it is NOT an atomic execution
lock — a simultaneous two-session race remains possible (recorded as TD-29; the loser's
stamp 412s into the existing partial-execution recovery path). The pre-existing
`IF-MATCH: *` fallback inside the service remains only for legacy callers and is not a
precedent for new update paths.

## 5. Cache model

Semantic keys (all under the `['approvals']` root, so existing root invalidations reach
every key by prefix): `approvals.pending()`, `approvals.actionable()`,
`approvals.byPerson(personId)`, `approvals.terminalRecent(limit)`. Keys carry no status
arrays — parameter ordering cannot create duplicate keys for equivalent sets. All four
legacy submission hooks now invalidate `approvals.all()` on successful submission
(participant submission already did).

## 6. Mock parity

Mock DSM implements identical observable semantics for the five methods — same status
filtering, same Id-desc ordering, same windowing, same null-on-missing `getApproval` —
with no artificial page simulation. Multi-page assembly, dedup, fail-closed, integrity,
cancellation, and ETag header behaviour are proven by compiling the REAL SharePoint
service against an injected fetch boundary in the s31 harness.

## 7. Index gate (owner-executed BEFORE deployment)

Required indexed columns on C3Approvals: **Title, ApprovalStatus, TargetPersonID,
OperationType**. `SubmittedAt` requires no index (ordering moved to Id).

Read-only verification (browser console at /sites/C3):

```javascript
await (await fetch(`${location.origin}/sites/C3/_api/web/lists/getbytitle('C3Approvals')/fields?$select=InternalName,Indexed&$filter=Hidden eq false and ReadOnlyField eq false`,
  {headers:{Accept:'application/json;odata=nometadata'},credentials:'same-origin'})).json();
```

Also capture, as operational evidence: `?$select=ItemCount` on the list, and
`items?$select=Id&$orderby=Id desc&$top=1` (highest Id).

If any required index is absent, STOP before deployment and apply non-destructively
(per missing field; alter nothing else — no fields, rows, content types, permissions,
or views):

```javascript
// fieldTitle = the InternalName missing an index, e.g. 'ApprovalStatus'
const web=`${location.origin}/sites/C3`;
const digest=(await (await fetch(web+'/_api/contextinfo',{method:'POST',credentials:'same-origin',headers:{Accept:'application/json;odata=nometadata'}})).json()).FormDigestValue;
await fetch(`${web}/_api/web/lists/getbytitle('C3Approvals')/fields/getbyinternalnameortitle('${fieldTitle}')`,
 {method:'POST',credentials:'same-origin',headers:{Accept:'application/json;odata=nometadata','Content-Type':'application/json;odata=verbose','X-RequestDigest':digest,'X-HTTP-Method':'MERGE','IF-MATCH':'*'},
  body:JSON.stringify({__metadata:{type:'SP.Field'},Indexed:true})});
// then re-run the read-only verification and record before/after here.
```

Evidence to record here after execution: index verification output · ItemCount ·
highest Id · date · executing account.

## 8. Out of scope (locked)

Approval lifecycle redesign; new statuses; new SP columns/lists; ACL changes; atomic
execution-claim schema; readiness facets/work items; C3Contracts; mission-readiness
semantic changes; migrating the legacy `IF-MATCH: *` fallback (tracked, not licensed).
