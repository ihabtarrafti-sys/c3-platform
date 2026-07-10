# S8 — Prize Distribution Engine (Track A)

**Status: BUILT + CERTIFIED, not yet deployed** (deploys batch at the owner's
return) · migration `0028`

GK-Core runs this by hand in the prize mastersheet: tournament income → org
cut → per-player shares (individual %s, coach cuts) → a payout list with
status and payment-source label. S8 makes the sheet a record with laws.

## The laws

1. **Only RECEIVED money is distributed.** A distribution allocates ONE
   income line's landed pool (`receivedAmountMinor ?? amountMinor`) — you
   split what arrived, not what was hoped for. One LIVE distribution per
   line (partial-unique index + friendly 409).
2. **Org cut + Σ share amounts == pool, EXACTLY.** The org's cut floors
   (the org never rounds itself up at the players' expense); the player pool
   splits by basis points with LARGEST-REMAINDER allocation. No cent is ever
   lost or invented — the allocator asserts the invariant at runtime and the
   domain tests hammer it with rounding storms.
3. **Shares must sum to exactly 100%** of the player pool (basis points);
   org-only distributions are legal at exactly 100% org share. Refusals are
   whole — no partial allocations.
4. **Payouts are facts.** Pending → Paid demands a payment-source **LABEL**
   (ESA, ADCB — account numbers are never stored, standing law) plus an
   optional bank reference; `paidOn` stamps automatically. Paid → Pending is
   a legal audited correction — history keeps both events.
5. **Revoke is honest.** Reason mandatory; legal only while EVERY payout is
   pending — once money moved, corrections happen per row, never by erasing
   the allocation. A revoked distribution stays in history; the line frees
   up and a corrected allocation gets a fresh DIST id.

## Seeds

`GET /distributions/seed?missionId=` returns the mission's team roster
(S7's `mission.teamId`) with each member's ACTIVE agreement's
`PrizeSharePersonal` term as the suggested share — provenance included
(`sourceTermId`). Suggestions only; the human edits before committing.
Untagged missions seed empty; rows are added manually.

## Posture

Direct-but-audited (the S6/S2 finance standing): writes
`assertManageMissions + assertViewFinancials`; reads `assertViewFinancials`.
Audit: `DistributionCreated` (full allocation snapshot) on the distribution
trail + a mission-trail echo; `PayoutMarked` per flip; `DistributionRevoked`
with the reason.

## Signals ship with features

**PayoutsOutstanding**: a LIVE distribution with pending rows is money the
org holds that belongs to people — attention from day one (impact 2 ×
urgency 2), immediate at 14 days. The pending amount is printed; the cockpit
ledger grows to 11 checks.

## Surfaces

- **Mission page → Prize distributions** (finance-gated, below the P&L):
  Distribute… on Received income lines — pool picker, org %, seeded share
  rows (% of player pool, live sum check), add-person row; distribution
  cards with the pool/org-cut arithmetic visible, the payout table
  (Mark paid… with the label rule, Unmark as audited correction), Revoke…
  with reason.

## Evidence

- `packages/domain/test/distribution.test.ts` — the exact-sum law (clean
  splits, ugly thirds, a 7-way rounding storm over four pool sizes,
  determinism), org-only legality, 100% refusals, duplicate refusals, input
  contracts.
- `apps/api/test/distributions.test.ts` — over HTTP: seed carries the 45%
  PrizeShare suggestion with its TRM id; not-Received refused; allocation
  over the RECEIVED pool (partial receipt); the law asserted on the wire;
  one-live-per-line 409; bad-sum refused; PayoutsOutstanding in /situation
  with the DIST named; label-mandatory 400; Paid → correction → revoke →
  re-allocation as DIST-0002; audit trail; visitor 403s.
- `apps/web/e2e/settlement.spec.ts` — grew the distribution walk: received
  money → Distribute (org 100%, the exact-sum card) → revoke with reason →
  the stack stays quiet for the cockpit spec.
