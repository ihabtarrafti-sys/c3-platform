# S9 — Expense Claims (Track A)

> **OWNER RATIFIED 2026-07-10: claims stay CORE finance (Open-Q2 closed).**

**Status: BUILT + CERTIFIED, not yet deployed** (deploys batch at the owner's
return) · migration `0029` · retires the Power Automate "Finance
Intelligence Hub"

The hub today: staff submit expense rows by MS Form into an Excel log with
tinyurl receipt links; the owner flips Status cells by hand ("Reviewed By:
Ihab"); an export maps to payroll columns. S9 makes the same flow a record.

## The lifecycle

```
Submitted → InReview → Approved → Paid
                     ↘ Rejected (reason mandatory)
```

- **A claim is ONE expense item** (amount + currency + category from the
  expense taxonomy + date + description; optional person/mission context).
  Batches are just several claims — submitting is cheap by design.
- **Anyone except read-only roles submits** (staff get their money back);
  the visitor role has no claims surface at all.
- **Deciding takes finance standing** (financial visibility + operational
  standing — owner/operations today), and **the submitter may never decide
  their own claim** — `checkSelfReview`, the exact separation law the
  approval pipeline enforces. On their own claim page the decision buttons
  are absent, not disabled.
- **Paid records the payment fact**: bank **LABEL** only (ESA, ADCB — the
  standing never-store-account-numbers law) + optional bank reference;
  `paidOn` stamps automatically. Rejected and Paid are terminal.
- **Receipts** are S4 documents owned by the claim (`Claim` owner type) with
  a **record-scoped read gate**: the submitter reads their own receipts;
  finance standing reads all; nobody else — receipts carry money.
- **Reads are per-actor**: everyone sees their own register; finance sees
  all. Cross-submitter reads are a truthful 403.

## Signals ship with features

**ClaimsAwaitingReview**: a Submitted/InReview claim ≥3 days old is
someone's own money in limbo (the ApprovalStale doctrine applied) —
attention at 3 days, immediate at 7. Fresh and decided claims are quiet.
Cockpit ledger = 12 checks.

## OPEN QUESTION 2 — for the owner to ratify (his call, per the plan)

The plan of record holds: *"expense claims: core finance vs part of the HR
paid module (recommendation: core)"*. **Built as CORE per that recorded
recommendation** — reversibly. The options, honestly weighed:

**Option A — CORE (built, recommended).** Claims are operational finance:
they feed the payroll export and the mission cost picture, and Geekay's
worst pain (the plan ranks the Finance hub top-2) shouldn't sit behind a
paid module for the org's own use. Every role that spends money can claim —
that's org-wide plumbing, like approvals. Cost: one more core surface to
maintain.

**Option B — HR MODULE.** Claims are people-ops (reimbursements to staff),
bundled with the HR pack for licensees; core stays leaner and the module
gets a flagship feature. Cost: Geekay's own daily flow rides module
plumbing; the module boundary would need per-diem/mission expense carve-outs
back into core anyway (mission money IS core), splitting one flow across a
boundary.

**Repackaging cost if you choose B later**: low by design — `claimOps` is a
self-contained module (own table, own gates, own routes, own pages); moving
it behind a module flag is configuration plus nav gating, not a rewrite.
Nothing else imports it except the Situation Room signal (which would gate
with it).

## Surfaces

- **Claims register** (`/claims`, nav for every non-read-only role): your
  claims (or all, for finance) + the submit drawer.
- **Claim page**: the definition, receipts (upload/download under the
  record-scoped gate), decision actions (finance, never the submitter),
  full audit history.

## Evidence

- `packages/domain/test/situation.test.ts` — the signal fires at ≥3d
  Submitted/InReview only.
- `apps/api/test/claims.test.ts` — lifecycle end to end; visitor 403s;
  per-actor reads (own vs all, cross-submitter 403); the separation law on
  the wire (ops blocked from own claim, hr blocked without standing);
  receipts behind the record gate (submitter 200, visitor 403); reject
  demands a reason; pay demands a label; terminal states hold; audit trail;
  fresh claims quiet in /situation.
- `apps/web/e2e/claims.spec.ts` — the human walk: hr submits and sees only
  theirs → ops reviews/approves/pays with the label → the story on the page
  → hr sees Paid with decision buttons absent → visitor fail-closed.
