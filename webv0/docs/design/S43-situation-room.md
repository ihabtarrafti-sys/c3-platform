# Sprint 43 — The Situation Room (Concept & Increment Plan)

**Author:** Architect-of-record · **Date:** 2026-07-09 · **Owner direction:** pivot from the SP work queue — "next level, up to par with our vision, something unique and extraordinary, not basic data for each whatever."

## The concept: a decision engine, not a data display

The SP Command Center showed severity-banded *rows per record type*. Any tool can do that. What no register-viewer does — and what our connected domains now make possible — is tell the operator **stories that cross domains, each with its reasoning shown and its next action attached**:

> ⚠ **MSN-0002 "Hub Mission" is 12 days out and not ready.**
> PER-0001 (Analyst) — Coaching License expires in **9 days** (before the mission starts) · their Player Contract entered **Due-30** · no renewal request is pending.
> **[Request credential renewal] [Renew agreement] [View mission]**

One card. Three domains. The reasoning on its face. The fix one click away — pre-filled, governed, using the in-context action machinery S42 just built. That is "the workflows each option has with each other," weaponized.

## The three pillars

**1. SIGNALS — derived, cross-domain, stateless.** Pure read-side derivation (the `credentialStatusOn` doctrine — no scheduler, no stored flags, always current, nothing to go stale or lie):
- *Expiring coverage*: credential ExpiresSoon/Expired; agreement Due30/60/90/Expired — **joined against what it blocks** (is this person on an active mission? does the agreement end before the mission does?).
- *Mission readiness*: active mission approaching start with roster gaps, or any active participant whose credential/agreement lapses before or during the mission window. **Readiness is a computed state with named reasons, never a stored badge.**
- *Pipeline health*: approvals sitting unactioned N+ days; ExecutionFailed awaiting resubmit; **wedge detection** — an open approval whose submitter is the org's only owner (we learned that one live).
- *Journey drift*: journeys Suspended beyond a threshold.

**2. EXPLAINABLE PRIORITY — intelligence without theater.** Every signal gets a deterministic score: **impact** (does it block a mission? touch money? lock governance?) × **urgency** (days remaining, banded). The score's *components are printed on the card* ("blocks mission readiness · 9 days · no fix pending"). No black box, no ML cosplay — auditable reasoning, in the product's truthfulness DNA. Signals that already have a pending fix (a matching open approval) automatically demote to "in motion" — the queue never nags about what's already being handled.

**3. NEXT ACTION IN-CONTEXT.** Every card carries the governed dialogs that resolve it, pre-filled (person, agreement, mission — whatever the story is about). The cockpit is where work *starts*, not where it's read about.

**Honesty rules carried over:** zero-signal state says "Nothing needs your attention — here's what was checked" (the checks enumerated, so silence is provably not blindness); role-gating composes (a viewer without `canViewFinancials` gets agreement signals without amounts; hr/visitor get no agreement signals at all); every derivation happens server-side per-actor.

## Increments

- **Q1 — the signal engine (domain)**: pure functions over the existing entities — `missionReadinessOn(mission, roster, credentials, agreements, today)`, signal composition + scoring types, exhaustive unit matrix (the heart of the sprint; ~everything testable without a DB).
- **Q2 — the read model + API**: one endpoint `GET /api/v1/situation` returning the actor's scored, explained, role-filtered signal set (single aggregate query pass; no N+1); HTTP tests incl. role-composition and the in-motion demotion.
- **Q3 — the cockpit UI**: the Situation Room page as the app's landing surface for operational roles — story cards, reasoning lines, in-context actions, the honest all-clear. **This is also where the design-elevation bar starts applying (S44's language debuts here — the flagship screen gets the Command Desk treatment first).**
- **Q4 — E2E + deploy + certification.**

## Claims note

"Intelligence"/"insights" wording is NOT claimable externally without a fresh truthfulness pass; internally we say what it is: derived, explainable, cross-domain signals.
