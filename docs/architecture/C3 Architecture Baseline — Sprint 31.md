# C3 Architecture Baseline — Sprint 31

**Status:** Authoritative until Sprint 32 closeout
**Date:** 2026-07-05
**Supersedes:** C3 Architecture Baseline — Sprint 30 (preserved as historical)
**Head commits at baseline:** `c0c186b` … `a422aaf` (+ the S31 closeout docs commit)
**Deployed runtime SHA-256:** `80df03b12c84214fbecce51754a1a1faffab3aa06896d8c9f8dfcc679f4a8032`
**Hosted state:** S31 runtime deployed; hosted Part 18 fully green (owner-confirmed 2026-07-05)

---

## Closeout statement

Sprint 31 delivered Approval Scale and Query Integrity: every approval read is now a
targeted semantic query over one internally paged, fail-closed, Id-desc-ordered core;
every consumer renders query failure truthfully; execution/review/recovery act on fresh
rows with ETag-bound updates; and the four required C3Approvals indexes are live. The
approval lifecycle, statuses, immutable Add-only submission, and ACLs are unchanged.

---

## Section 1 — Architectural shifts introduced in Sprint 31

1. **Semantic query classes over one paged core.** Consumers ask for what they MEAN
   (pending / actionable / by-person / recent-terminal / single-row) instead of shaping
   status filters; completeness or windowing is part of each method's contract, not the
   caller's problem. This is the template for any future list read that can outgrow one
   page.
2. **Numeric Id as the only authoritative order.** The SP item Id is monotonic, unique,
   indexed by nature, and already the APR identity source; `SubmittedAt` is client-clock
   display data. Any future paging/ordering design starts from Id.
3. **Fail-closed read integrity as a locked pattern.** Page failure, malformed body,
   untrusted next-link, or a mapper-rejected row inside a complete query rejects the
   whole read (`ApprovalQueryIntegrityError`, ERR-036, with rejected item IDs);
   cancellation (AbortError) is distinguishable from failure; no partial assembly is
   ever a success.
4. **Consumer failure states are part of the contract — and parity-testable.** The pure
   `utils/approvalInboxView.ts` module owns the inbox's unavailable-vs-empty semantics
   (extending the S30 trust rule from computed aggregates to query consumers): error
   mode for actionable failure, isolated terminal unavailability with `(—)` counts, and
   structural distinction of null (unavailable) from [] (genuinely empty).
5. **Freshness + ETag as the update precondition.** Execution, review, and stamp
   recovery read the live row first; the fresh status drives the guard and the fresh
   ETag preconditions the MERGE (412 → truthful concurrency surface into the existing
   recovery paths). Not an atomic claim — TD-29 records the residual race. No new
   `IF-MATCH: *`; the service-level fallback exists only for unmigrated legacy callers.
6. **Injectable fetch boundary for service-level parity.** The real SharePoint service
   is driven by a fake fetch in the s31 harness — paging, dedup, trust validation,
   integrity, cancellation, and header behaviour are proven against production code,
   not a re-implementation. No production-only seams.

## Section 2 — Approval read/write surface (authoritative)

| Method | Contract |
|---|---|
| `listPendingApprovals` | COMPLETE Submitted/InReview/Approved — duplicate guard + pending chips + readiness input |
| `listActionableApprovals` | COMPLETE + ExecutionFailed (never windowed) — inbox actionable tabs |
| `listApprovalsByPerson` | COMPLETE, server-filtered indexed TargetPersonID, OData-escaped — person history |
| `listRecentTerminalApprovals` | WINDOWED latest-N Executed/Rejected — UI labels the window truthfully |
| `getApproval` | fresh single row by numeric Id + current ETag; null = not-found; corrupt row throws |
| `createApproval` | UNCHANGED S29B immutable single Add-only POST |
| `patchApprovalStatus` / `stampExecution` | UNCHANGED semantics + optional fresh-ETag IF-MATCH (all production callers pass it) |
| `listApprovals` | LEGACY, contract-frozen, zero production consumers |

All semantic query keys live under the `['approvals']` root — root invalidation reaches
everything by prefix; all five submission hooks invalidate it on success.

## Section 3 — Write capability matrix

Unchanged from Sprint 30 (the sprint was read-integrity only). Approval lifecycle,
statuses, immutable submission, and all governed operations exactly as at S30 baseline.

## Section 4 — Security posture

Unchanged from Sprint 30: eight lists with verified unique least-privilege ACLs;
C3Contracts deferred (TD-28 residual). No ACL changes in S31. C3Approvals gained four
FIELD INDEXES only (Title, ApprovalStatus, TargetPersonID, OperationType — live-verified
2026-07-05; schema doc updated with the provisioning-gap note).

## Section 5 — Validation gate (Sprint 31 shape)

Ten parity harnesses: s15 87 · s16 220 · s17 51 · s18 55 (legacy contract unchanged) ·
s27 28 · s28 35 · s29 38 · s29b 34 · s30 59 · **s31 55** + tsc ×2 + strict build
(**UNPIPED — exit code must be observed; TD-30**) + verify:runtime + NUL audit.
Rule: an unchanged runtime SHA after source changes is a red flag — verify:runtime
proves dist/asset consistency, not freshness.

## Section 6 — Tech debt state

**Resolved in S31:** TD-06 (getApproval), TD-07 (server person filter), TD-19 (approval
truncation — approval surface only). **New:** TD-30 (canonical fail-fast gate command —
process hardening, open). **Open by design:** TD-29 (simultaneous-execution race; needs
an explicit claim/idempotency design). **Other open:** TD-23, TD-26, TD-14/15,
C3Contracts + TD-22, TD-24, TD-28 residual (C3Contracts ACL), UpdateMissionParticipant /
reactivation UI / kit metadata edits, top-N caps on non-approval domains, s15–s17
inline parity migration.

## Section 7 — Roadmap

**Sprint 32 candidates (recorded, not designed):** ① Readiness v1.1 (apparel facet +
batch read; kit work-item facet) + TD-30 gate command; ② C3Contracts activation
(+ ACL posture + TD-22); ③ TD-26 confirmation write design; ④ TD-29 execution claim.
All locked decisions honoured; mock DSM remains the regression baseline; Situation Room
untouched; Contracts/Amendments/Intelligence and TD-26 guards unchanged.
