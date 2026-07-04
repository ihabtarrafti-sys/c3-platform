# C3 Platform — Senior Engineer Handoff Package — Sprint 31

**Document type:** Authoritative technical memory — delta handoff for a fresh advanced-AI session
**Prepared:** 2026-07-05, from direct inspection of the current source tree (source wins over every older document)
**Supersedes:** the Sprint 30 handoff **for everything stated here**; the S30 package
(and through it S29B) remains authoritative for all unchanged detail (readiness model,
domain inventory, ACL posture, approval lifecycle, environment notes).
**Sprint state:** Sprint 31 CLOSED and hosted-green (2026-07-05) · Sprint 32 NOT started, direction not approved

---

## 1. Repository state at handoff

| Item | Value |
|---|---|
| Working copy | `C:\Projects\c3-fable` (branch `master`; Claude commits, the user pushes) |
| Closeout commit | `docs(s31): Close approval scale and query integrity sprint` (follows `a422aaf`) |
| Sprint 31 commit range | `c0c186b` … `a422aaf` (6 core + 2 correction) + 1 closeout commit on top of `4633e12` |
| **Deployed runtime SHA-256** | `80df03b12c84214fbecce51754a1a1faffab3aa06896d8c9f8dfcc679f4a8032` (hosted-verified) |
| Clean-tree expectation | tracked tree clean; `docs/fable/` and `docs/Handoff v2/` intentionally untracked |

**Validation gate (Sprint 31 shape — ALL required before any source commit):** ten
parity scripts — s15 87 · s16 220 · s17 51 · s18 55 · s27 28 · s28 35 · s29 38 ·
s29b 34 · s30 59 · **s31 55 (`scripts/s31-parity-approval-queries.mjs`)** — plus tsc ×2,
the MANDATORY strict build (`npm run beta:runtime`) **run UNPIPED with its exit code
observed**, `npm run verify:runtime`, and the NUL/truncation audit.

**⚠ TD-30 gate lesson (S31 incident, survived to deployment gate only because the SHA
was watched):** piping `beta:runtime` through `tail` makes the pipeline exit code
`tail`'s — a strict-build failure was masked and `verify:runtime` PASSED on a
matching-but-stale bundle pair, with an UNCHANGED SHA after source changes as the only
tell. Rules: never discard a gate step's exit code; an unchanged runtime SHA after
source edits is a red flag (verify:runtime proves consistency, not freshness). The
canonical single fail-fast gate command is an open backlog item — build it early.

## 2. What Sprint 31 added (delta over S30)

### Approval read architecture (Approval Query Integrity — Sprint 31.md is authoritative)

- One internally paged, fail-closed read core in `SharePointApprovalsService`
  (injectable `fetchImpl` for the harness): single-status indexed queries,
  **`$orderby=Id desc`** (the ONLY authoritative order — SubmittedAt is client-clock
  display data), `odata.nextLink` followed to exhaustion with same-origin `/_api`
  validation, AbortSignal per page, no partial assembly ever returned.
- Semantic methods: `listPendingApprovals` (COMPLETE Submitted/InReview/Approved) ·
  `listActionableApprovals` (COMPLETE + ExecutionFailed — never windowed) ·
  `listApprovalsByPerson` (COMPLETE, server-filtered indexed TargetPersonID, escaped) ·
  `listRecentTerminalApprovals` (windowed latest-N, UI says so) ·
  `getApproval` (fresh row + ETag by numeric Id; null = not-found; corrupt row throws).
- `ApprovalQueryIntegrityError` (ERR-036): ANY mapper-rejected row in a complete query
  rejects the whole read with the rejected item IDs. Empty success ≠ unavailable —
  structurally distinct everywhere.
- Consumer failure states are pure and parity-tested (`utils/approvalInboxView.ts`):
  actionable failure ⇒ inbox error mode (no counts/lists); terminal failure alone ⇒
  actionable stays visible, terminal tabs `(—)`/unavailable; MissionWorkspace shows
  "Pending changes unavailable"; person history errors truthfully; readiness keeps its
  S30 informational-pending rule (pending failure nulls indicators only).
- Duplicate-pending guard reads the COMPLETE pending set and FAILS CLOSED.
- All five submission hooks invalidate the `['approvals']` root on success.
- Freshness + ETag: execution, approve/reject, and all three recovery hooks read the
  live row first; fresh status drives the guard; fresh ETag is the IF-MATCH (412 →
  existing partial-execution recovery). NO new `IF-MATCH: *` — the service fallback
  exists only for unmigrated callers and is not a precedent.
- Query keys: `approvals.pending/actionable/byPerson(id)/terminalRecent(limit)` — all
  under the `['approvals']` root (root invalidation reaches everything).
- Legacy `listApprovals`: contract-frozen, zero production consumers, s18 unchanged.

### C3Approvals live indexes (Part 18.0 evidence, 2026-07-05)

Title, ApprovalStatus, TargetPersonID, OperationType — all were **false** live (the
schema doc's "Indexed: Yes" was never provisioned); remediated via the fail-closed
owner console script; all four verify **true**. ItemCount 35, highest Id 52 at
verification. SubmittedAt deliberately NOT indexed. Schema doc §3 carries the note.

## 3. Guardrails (unchanged, all live)

Everything in the S30/S29B handoffs stands. S31 additions to the locked pattern set:
Id-desc is the only authoritative approval order; complete-query fail-closed integrity
(no silent partials); unavailable ≠ empty for every query consumer; freshness+ETag
precedes status-changing approval actions. Intentionally unchanged in S31: approval
lifecycle/statuses, immutable Add-only submission, approval ACLs, the legacy stamp
concurrency model outside the ETag-bound paths, S30 readiness semantics, SituationRoom,
C3Contracts, Readiness v1.1 deferrals.

## 4. Tech debt state

**Resolved in S31:** TD-06, TD-07, TD-19 (approval surface only — top-N caps on other
domains remain open). **New/open:** TD-30 (canonical fail-fast gate command — process
hardening). **Open by design:** TD-29 (simultaneous two-session execution race —
freshness prevents stale sequential actions only; resolution needs an explicit
execution-claim or operation-level idempotency design, owner-decided).
**Other open:** TD-23 (Intelligence cold-load), TD-26 (mission confirmation write),
TD-14/15 (manual CI/CD + committed runtime), C3Contracts + TD-22 + TD-28 residual ACL,
TD-24 (People Email), UpdateMissionParticipant / reactivation UI / kit metadata edits,
s15–s17 inline parity migration.

## 5. Sprint 32 launch point (candidates — owner decides at Phase 0)

1. **Readiness v1.1 + TD-30 gate command** (recommended): apparel facet + a new
   `listAllApparelProfiles` batch read (none exists — only `getApparelProfile(personId)`),
   kit `MissionReadinessGap` facet (the trigger union already extends without renaming),
   plus the small canonical gate script.
2. **C3Contracts activation:** provisioning + ACL posture (S30 rev 2 package applies) +
   guard removal + TD-22 migration.
3. **TD-26:** governed mission-confirmation write design.
4. **TD-29:** execution-claim design.

## 6. First-day checklist for a new session

1. `git -C C:\Projects\c3-fable status` + `git log --oneline -15` — clean tree at/after
   the S31 closeout commit; two untracked doc dirs expected.
2. Read: `C3 Architecture Baseline — Sprint 31.md`, `Sprint 31 Closeout Report.md`,
   `C3 Beta Checkpoint — Sprint 31.md`, `Approval Query Integrity — Sprint 31.md`,
   `C3 Tech Debt Register.md`, this package, then the S30/S29B packages for unchanged
   architecture detail.
3. Run the complete ten-script gate — exact totals; strict build UNPIPED (TD-30).
4. Verify the deployed runtime SHA against §1.
5. Report discrepancies (code wins) before relying on any document.
6. Do not start Sprint 32 implementation without an approved Phase 0.
