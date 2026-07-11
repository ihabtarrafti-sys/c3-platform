# HARDEN-1 — audit response, part 2 (owner-resequenced before the review pass)

**Status: BUILT + CERTIFIED. Migration 0034.** Owner order: H-06 → H-04 →
H-05 → M-items. H-02 parked by owner decision pending the codex +
`/code-review ultra` pass.

## Fixed in this increment

**H-06 — per-diem in org/team P&L (the honesty law).** The bulk participant
read was a slim projection (no per-diem, no names); both summaries passed
`participants: []` into the P&L engine while the UI said "P&L" and "ROI".
The bulk read now joins names and carries per-diem; the finance dashboard
and the team report blend the SAME truth as each mission's own page.
Evidence: teams.test "HARDEN-1 H-06" — a 5-day mission with a 100.00/day
participant shows the 500.00 in team expense AND the dashboard row.

**H-04 — the last-owner race.** `member_set_role` / `member_set_active`
were check-then-write; two concurrent owner demotions could both pass the
last-owner check. 0034 replaces both SECURITY DEFINER functions (0008 stays
frozen per H-08) with one added line: a per-tenant transaction-scoped
advisory lock before any check. Evidence: db.test "HARDEN-1 H-04" — two
REAL connections demote each other's owner concurrently; exactly one is
refused with LAST_OWNER_PROTECTED and the tenant is never ownerless.

**H-05 — the finance lock-order.** App side: Settled is now ABSORBING
(every finance-child write refuses on a Settled mission); the settlement
check reads + LOCKS the mission's lines inside its own transaction;
allocation LOCKS the source line before snapshotting the pool; revoke and
payout serialize on the SAME distribution-head lock. Database side (0034):
a payout cannot flip to Paid under a non-Live head, and a line's money
truth (amount, currency, received, active) is FROZEN while a Live
distribution references it. Evidence: db.test "HARDEN-1 H-05" proves both
triggers refuse direct SQL; all finance suites green under the locks.

**M-06 — TRUNCATE denial on the append-only streams.** Statement-level
BEFORE TRUNCATE triggers on audit_event / approval_event / access_event.
No production break-glass exists by design; the embedded test harness
resets via superuser `SET LOCAL session_replication_role='replica'`.

## Dispositions (documented, deliberate)

- **M-05 — DISPUTED / accepted-as-designed.** tenant_membership and
  role_assignment stay ENABLE-without-FORCE: 0002's recorded decision — the
  auth resolver must read memberships to resolve a principal's tenant
  BEFORE tenant context exists. Forcing would break Entra sign-in's
  bootstrap. c3_app holds zero grants on these tables regardless.
- **M-01 (relational closure) — DEFERRED to a dedicated migration** after
  the review pass: composite FKs across ~10 loose text refs are a data-risk
  change that deserves its own window; the H-05 triggers already close the
  divergences the audit demonstrated as exploitable.
- **M-02 (Number intermediates / FX rounding) — DEFERRED** to a focused
  money-path pass; integer cents stay ≪ 2^53 in every current path.
- **M-03 (last-write-wins) — fx_rate ACCEPTED** (a current-value cell by
  design); budgets / per-diem / team-membership version guards deferred.
- **M-04 (scale cliffs) — DEFERRED** (performance, not correctness; the
  tenant is one org today).
- **M-07 (MIME/byte verification) — DEFERRED** to the document-bytes lane
  (same work as the H-03 blob-export follow-up).
- **H-02 (signed restore manifest) — PARKED by owner** pending the
  consolidated review.

## Evidence
db.test.ts 24/24 (H-04 race on two connections; H-05 triggers; H-08 freeze;
H-03 catalog gate), teams.test H-06, all finance suites under the new
locks, full gate + E2E green.
