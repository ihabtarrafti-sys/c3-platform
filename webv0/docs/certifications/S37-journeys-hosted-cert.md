# Sprint 37 — Journeys Domain: Hosted Certification

**Author:** Architect-of-record · **Date:** 2026-07-08.
**Result: ✅ HOSTED-CERTIFIED** — deployed and exercised end-to-end on staging through both mutation patterns, the day after the sprint opened.

## Deployment evidence

- **Migration 0010** (owner-run): migrations 0001→0010; `journey` table **RLS ENABLE + FORCE**; grants exactly `INSERT, SELECT, UPDATE`; the terminal/ended coherence CHECK armed.
- **API**: owner-deployed; fingerprint verified (`GET /api/v1/journeys` anonymous → 401).
- **Web**: Pages deployment `1d2b09d9`, bundle `index-DEulqhbS.js`, marker-scan CLEAN, safe-order verification passed.

## Hosted smoke (owner-driven, Architect-verified in the product audit stream)

The first full lifecycle on the hosted product, in `c3-internal`:

- **Governed initiation:** APR-0013 `InitiateJourney` Executed — submitted by m.khalailah (ops), executed by ihab (owner); requester ≠ approver held. **JRN-0001** born `Active` for PER-0001; `startedOn` stored byte-for-byte as entered (`2026-01-07`).
- **Direct-audited transitions, run as OPERATIONS** (exercising `canOperateJourneys` hosted): `JourneySuspended` → `JourneyResumed` → `JourneyCompleted`, each with before/after status images and the true actor (`m.khalailah`), 11 seconds apart — immediate effect, immediately recorded, exactly as the dialogs promise.
- **Terminal state coherent:** status `Completed` + `endedOn = 2026-07-08` (the DB CHECK guarantees this pairing), version 3 = exactly three transitions, and the owner confirmed the terminal row offers **no lifecycle buttons** — the state machine drives the UI.

**Durable fixtures:** JRN-0001 + APR-0013.

## What Sprint 37 proved beyond the feature

1. **Both mutation patterns now run hosted**: the governed approval pipeline (4 domains) AND direct-but-audited transitions — the pattern pair that covers everything Kit/Apparel/Missions will need.
2. The state machine is enforced at **three layers** (UI affordances, application validation, SQL statement guard) with a DB coherence invariant beneath — and the hosted run touched all of them.
3. CP-parity scoreboard: **People ✅ Credentials ✅ Journeys ✅ Members ✅** — remaining: Kit, Apparel, Missions.

## Claims note

No public claim about Journeys exists or is authorized; roadmap band framing unchanged; any wording routes through the truthfulness sign-off.
