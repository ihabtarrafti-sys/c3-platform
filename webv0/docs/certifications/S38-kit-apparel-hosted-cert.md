# Sprint 38 — Kit & Apparel Domains: Hosted Certification

**Author:** Architect-of-record · **Date:** 2026-07-08.
**Result: ✅ HOSTED-CERTIFIED** — both equipment domains deployed and exercised live through the full direct-audited CRUD lifecycle.

## Deployment evidence

- **Migration 0011** (owner-run): migrations 0001→0011; `kit` + `apparel` both **RLS ENABLE + FORCE**; grants exactly `INSERT, SELECT, UPDATE` (no DELETE).
- **API**: owner-deployed; fingerprint verified (`GET /api/v1/kit` anonymous → 401).
- **Web**: Pages deployment `9fe8c6a6`, bundle `index-BbPDXzHt.js`, marker-scan CLEAN, safe-order verification passed.

## Hosted smoke (owner-driven as OPERATIONS; Architect-verified in the audit stream)

- **KIT-0001**: `KitCreated` → **`KitUpdated` with before/after images of ONLY the changed field** (`{"name": "Staging Cert Headset"}` → `{"name": "repaired"}` — category and assignment correctly absent from the images) → `KitDeactivated` (`isActive` true→false). Final state: Inactive, **version 2 = exactly two mutations**, all actors truthfully `m.khalailah`. Owner confirmed the retired row offers no actions.
- **APL-0001**: `ApparelCreated` (name/category/size L), Active — the apparel path live.
- **Certification integrity note:** the first smoke pass covered creates only; the Architect's audit-stream verification caught the missing edit/deactivate steps **before** certification, and the owner completed them — the standard held: nothing certified ahead of evidence.

**Durable fixtures:** KIT-0001 (Inactive) + APL-0001.

## What Sprint 38 proved beyond the features

1. The **changed-fields-only audit discipline is hosted-proven** — the platform's most precise audit images yet.
2. The **direct-audited pattern generalizes**: one generic core (backend) + one shared register component (frontend) carried two domains with zero pattern additions.
3. The **HR capability split** (apparel yes, kit no — CP ACL parity) is live: HR's first write affordance, E2E-proven in the browser.
4. The optimistic **version guard carries the SP-era ETag/412 discipline** end to end (stale writes 409 with zero change, proven over HTTP).

## CP-parity scoreboard

**People ✅ Credentials ✅ Journeys ✅ Members ✅ Kit ✅ Apparel ✅ — Missions is the sole remaining domain.**

## Claims note

No public claim about Kit/Apparel exists or is authorized; roadmap band framing unchanged.
