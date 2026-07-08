# Sprint 43 — The Situation Room: Hosted Certification

**Author:** Architect-of-record · **Date:** 2026-07-09.
**Result: ✅ HOSTED-CERTIFIED** — the decision-engine cockpit live on staging, with the strongest possible evidence: it found real, unplanned problems on its first live look.

## Deployment evidence

No migration (0014 already live). API owner-deployed (`GET /api/v1/situation` anonymous → 401; health 200). Web Architect-deployed: Pages `a258186e`, bundle `index-BVA8k6qs.js`, marker scan CLEAN, safe-order verified. Operational users now land on `/situation`.

## Hosted smoke (owner-driven; Architect-verified against the staging records)

**The sentinel's real catches (unscripted):** on first open, the cockpit surfaced **two genuine governance wedges** — APR-0002 and APR-0003 (AddPerson, submitted by the owner on 2026-07-06 in the Phase 2C era, open ever since, with exactly one directory owner). Verified in the database exactly as the cards claimed. Nobody had noticed them for three days; the engine saw them in one pass.

**The flagship story, live:** CRED-0003 "Demo License" (expires 2026-07-14) on PER-0001, who sits on the active roster of MSN-0002 "Hub Cert Mission" → an **immediate** card (`P9 · impact 3 × urgency 3`) with the reasoning printed: the exact days, **the mission named**, "No replacement request is pending". The primary action led to the person hub; replacement requests were submitted and the story demoted to **In motion**; replacements executed (APR-0033/0034/0037, sub=ops rev=owner throughout). The owner additionally exercised withdraw twice more on his own submissions (APR-0035/0036 → Withdrawn).

**E2E certification** (suite #9, 9/9): the spec itself caught a real wedge in the shared test stack on its first run and now resolves it through the product; it also proves the all-clear enumerates its checks, the demotion loop, and the fail-closed read-only page.

## What Sprint 43 proved

1. **Cross-domain reasoning works on real data** — credential × mission window × roster, one story card, exact numbers.
2. **The wedge sentinel pays for itself** — three real catches before the sprint even closed (two on staging, one in the E2E stack).
3. **Explainable priority holds the truthfulness line** — every score shows its own math; "in motion" never nags about pending fixes; the all-clear proves what it checked.

## Operational disposition

APR-0002/0003 remain open on staging deliberately until the owner acts; recommended: **withdraw both via their cards** (one click each) — the approval events preserve the Phase 2C evidence while giving the records an honest terminal state and clearing the cockpit.

## Claims note

No public claim. "Intelligence/insights" wording remains unclaimable without a fresh truthfulness pass; the truthful internal phrase is: derived, explainable, cross-domain signals.
