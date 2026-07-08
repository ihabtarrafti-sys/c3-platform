# Sprint 41 — Agreements Domain: Hosted Certification (the first domain BEYOND the CP)

**Author:** Architect-of-record · **Date:** 2026-07-08.
**Result: ✅ HOSTED-CERTIFIED** — the full governed material lifecycle (create with value → renew → terminate), the addendum linkage, the financial role boundary, and — unplanned but invaluable — the single-owner wedge finding with a fully governed live recovery.

## Deployment evidence

- **Migration 0013** (owner-run): 13/13, latest `0013_agreements.sql`; `agreement` **RLS ENABLE + FORCE**; grants exactly `INSERT, SELECT, UPDATE`; operation-type CHECK carries all three agreement ops; `agreement_code_unique` partial index armed.
- **API** (owner-deployed): `GET /api/v1/agreements` anonymous → 401; health 200.
- **Web** (Architect-deployed): Pages deployment `b704e029`, bundle `index-6zRL6Z-W.js` (1,053,431 B), A-6 marker scan CLEAN on the exact artifact, safe-order verification passed (direct asset 200 → propagation → custom-domain real-browser page-load).

## Hosted smoke (ops = m.khalailah, owner = ihab; Architect-verified in the audit stream)

- **AGR-0001** "Player Contract" `STG-PL-2026-001`, **value 25,000,000 cents ($250,000.00)** — governed creation (APR-0017, sub=ops rev=ihab); later renewed `2027-07-31 → 2028-07-31` via APR-0018 (see the wedge finding below).
- **AGR-0003** `STG-PL-2026-002` (18,000,000 cents) — the clean full lifecycle: created (APR-0021) → **renewed** (APR-0022; `AgreementRenewed` with the endsOn-only before/after image) → **terminated** (APR-0023; reason recorded in the audit image). Every chain sub=m.khalailah, rev=ihab. **The renewal write the CP never shipped is hosted-certified.**
- **AGR-0004 "Addendum" with `linked_agreement_id = AGR-0001`** (APR-0029) — the parent-child relationship live as a database fact; AGR-0001's page lists it under Linked agreements.
- **AGR-0002** "NDA Addendum" — created WITHOUT a parent link (smoke input omission, first pass); retained as an honest fixture of an unlinked agreement. Linkage proof was then delivered properly via AGR-0004.

## THE FINDING — the single-owner wedge (and its governed recovery, live)

During the smoke the owner submitted a renewal **as the owner** (APR-0018, sub=ihab). The self-review guard correctly refused ihab every review action on it; with only one owner in the org, **nobody was eligible to approve or reject it**, and the duplicate-pending guard then (correctly) froze AGR-0001's material lifecycle. An attempted self-serve role promotion was refused by the same guard family. **A single-owner organization can permanently wedge an approval by self-submitting.** The CP had the same blind spot, unrecorded.

**The recovery was performed entirely inside governance, live** — the strongest possible demonstration of the model:
APR-0024 ProvisionMember (certbeta@c3hq.org as legal; sub=ops, rev=ihab) → APR-0025 ChangeRole legal→owner (sub=ops, rev=ihab) → **APR-0018 executed by the second owner** (rev=certbeta; requester ≠ approver preserved) → afterwards the org was restored exactly: APR-0026 ChangeRole (m.khalailah owner→operations, rev=certbeta), APR-0028 DeactivateMember (certbeta; shared user → membership removed, sub=ops rev=ihab; **the resolver re-pins certbeta to their own tenant, restoring the A-1 fixture**), with APR-0027 a **Rejected** DeactivateMember along the way (a live rejection drill, requester ≠ reviewer). Post-state verified: ihab=owner, m.khalailah=operations, certbeta holds exactly one membership (their own tenant, 2 members intact).

**Dispositions:** (1) **"Withdraw my request"** — submitter may cancel their own approval while Submitted/InReview (terminal, audited, no side effects) — **scoped into Sprint 42**; (2) customer guidance: maintain ≥2 owners per organization; (3) UI item for S42: the agreement Edit… dialog should expose the parent-link field (the patch API already supports it).

## Financial boundary

Legal/hr/visitor checks were certified by the E2E suite (legal: no value column, no value row, no material affordances; hr/visitor: no nav + fail-closed page) and the HTTP tests (structural field omission; 403s). Hosted spot-check by owner as available staging identities allowed; the server-side omission is transport-proven by the C3 tests against the same build.

**Durable fixtures (never delete):** AGR-0001..0004 + APR-0017..0029 (including the Rejected APR-0027 and the wedge-and-recovery sequence — audit evidence of the governance model defending itself).

## What Sprint 41 proved beyond the features

1. **The platform now exceeds the CP in its own flagship domain**: the CP's contracts were read-only V1; webv0 runs their full governed lifecycle, with money as integer cents and material terms movable only through approval.
2. **The guard system defends against the org's own owner** — and recovery never required stepping outside governance.
3. **Structural financial omission** works end-to-end: the value field is absent, not masked, for roles without the capability.

## Claims note

No public claim about agreements/contracts exists or is authorized; wording routes through the truthfulness pass separately.
