# Sprint 31 Closeout Report — Approval Scale and Query Integrity
**C3**
**Sprint:** 31 — Approval Scale and Query Integrity
**Closeout date:** 2026-07-05
**Status:** CLOSED — hosted Part 18 fully green (owner-confirmed, incl. all Part 18.5 consumer failure-state drills)
**Preceding sprint:** Sprint 30 CLOSED (Mission Readiness Cockpit + core-list ACL hardening)
**Validation baseline:** eleven gate checks — ten parity harnesses (incl. new s31 55/55) + tsc ×2 + strict build (unpiped) + verify:runtime + NUL audit
**Final deployed runtime SHA-256:** `80df03b12c84214fbecce51754a1a1faffab3aa06896d8c9f8dfcc679f4a8032`

---

## Closeout statement

Sprint 31 closes as:

> **"No approval can be silently omitted, duplicated, misordered, or mistaken for
> absent. Every approval read is a targeted semantic query over one internally paged,
> fail-closed core ordered by the numeric SharePoint Id: the pending and actionable
> sets are complete at any list size (ExecutionFailed never ages out of the inbox),
> person history is complete and server-filtered on a live index, terminal history is
> a deliberately windowed view that says so, the duplicate-pending guard fails closed,
> every consumer renders query failure as an explicit unavailable state — never an
> empty success — and execution, review, and recovery act on a fresh row whose ETag
> preconditions the update."**

Sprint 31 does **not** close as:

> ~~"The approval lifecycle, statuses, or immutable Add-only submission changed (untouched)."~~
> ~~"An atomic execution claim exists (TD-29 open by design)."~~
> ~~"Approval ACLs changed (none)."~~
> ~~"The legacy stamp concurrency model was migrated outside the new ETag-bound paths (the '*' fallback remains for unmigrated callers only, not as precedent)."~~
> ~~"Broader top-N/pagination concerns beyond the approval surface were resolved (tracked separately)."~~
> ~~"Sprint 30 readiness semantics, Situation Room, C3Contracts, or the Readiness v1.1 deferrals were touched (all intentionally unchanged)."~~

## Delivered

- Complete fail-closed approval paging (`odata.nextLink` to exhaustion; same-origin
  `/_api` link validation; AbortSignal per page; no partial assembly ever returned).
- Numeric SharePoint **Id-desc authoritative ordering** (SubmittedAt demoted to
  client-clock display data).
- Targeted reads: `listPendingApprovals` · `listActionableApprovals` ·
  `listApprovalsByPerson` · `listRecentTerminalApprovals` · `getApproval` (fresh row +
  ETag; TD-06 retired).
- Complete actionable ApprovalInbox visibility (ExecutionFailed recovery affordances
  never windowed) + truthful terminal windowing ("Showing latest N", `+`/`(—)` labels,
  All-tab disclosure).
- Complete person approval history (server-filtered, OData-escaped, indexed).
- Complete participant duplicate-pending protection — fail-closed, never fail-open.
- Consumer-specific failure states (pure, parity-tested `utils/approvalInboxView.ts`;
  "Pending changes unavailable" on MissionWorkspace; person-history error state
  verified; readiness informational-pending rule preserved and harness-proven).
- Immediate approvals invalidation for all four legacy submission hooks.
- Fresh reads + ETag-bound review/execution/recovery updates (no new `IF-MATCH: *`).
- `ApprovalQueryIntegrityError` (ERR-036) with rejected-item diagnostics.
- Live indexes on Title, ApprovalStatus, TargetPersonID, OperationType (Part 18.0
  evidence: all four were false at ItemCount 35 / highest Id 52 — the schema doc's
  "Indexed: Yes" was design intent never provisioned; remediated fail-closed and
  verified true).
- s31 parity 55/55 (paging, dedup, ordering, fail-closed, integrity, cancellation,
  APR identity, person-filter equivalence, windowing, ETag headers, mock parity, and
  all consumer failure semantics). Hosted Part 18 fully green.

## Debt resolved (exact scope)

**TD-06** (getApproval) · **TD-07** (server-side person filtering) · **TD-19**
(approval $top=500 truncation and incomplete approval reads) — all resolved strictly on
the implemented approval surface. Broader top-N caps on other domains and any general
pagination concern remain tracked and are NOT claimed resolved.

## Open residual risk

**TD-29 remains open by design:** fresh reads + ETags prevent stale SEQUENTIAL actions;
they are not an atomic execution claim — simultaneous owner execution can still race
before the second stamp 412s. Future resolution requires an explicit execution-claim or
operation-level idempotency design (owner decision; never introduced silently).

## Validation-process finding (recorded as TD-30)

Piping `beta:runtime` through `tail` masked a nonzero strict-build exit; verify:runtime
then passed against two matching-but-STALE bundles, yielding an unchanged runtime SHA
after source changes — which was the detection signal. Operational rules now recorded
(never discard gate exit codes; an unchanged SHA after source edits is a red flag), and
the resolution — one canonical fail-fast validation command covering all parity gates,
both tsc checks, the strict build, runtime verification, and the NUL audit — is an
owned process-hardening backlog item (deliberately NOT implemented during closeout).

## Sprint 32 candidates (recorded, not designed — owner decides at Phase 0)

1. **Readiness v1.1 + TD-30 gate command** — the intentionally deferred apparel facet
   (+ `listAllApparelProfiles` batch read) and kit `MissionReadinessGap` facet, now
   sitting on the corrected complete pending source; pair with the small canonical
   gate script. Low regression risk, visible product increment, closes the process gap.
2. **C3Contracts activation** — provisioning + ACL posture (rev 2 package applies) +
   NavRail guard removal + TD-22 legacy migration.
3. **TD-26** — governed mission-confirmation write design (explicit ADR-013 operation
   vs documented exemption).
4. **TD-29** — execution-claim design (lower urgency while execution is single-owner).
