# A-3 — Design Foundation Hosted (Phase 2E-B) — Evidence Record

**Gate item:** A-3 (design foundation certified hosted). **Author:** Architect-of-record · **Record created 2026-07-07** (consolidating evidence from 2026-07-06; created because A-3 was the one green item without a dedicated evidence file — the Stage-4 dossier needed an authoritative pointer).
**Result: ✅ HOSTED-CERTIFIED (2026-07-06, in-browser verified per increment; owner visually confirmed on staging).**

## What was certified

The Command Desk design foundation (canonical authority: `c3-governance/product/design/A-PRODUCT-FOUNDATION.md` — Concept C "Split Authority") implemented across the full product surface and **deployed to `staging.c3hq.org`**, verified in a real browser after every increment (the curl-only blank-page incident made in-browser verification mandatory):

| Increment | Scope | Commit | Pages deployment / bundle |
|---|---|---|---|
| B1 shell | 3-zone shell (IdentityBar / NavRail / work canvas), Fluent v9 brand theme, `--c3-*` tokens, official A2.2 mark | `effb439` | `89a1c118` / `index-D7zDrve7.js` |
| B2 auth surfaces | AuthScreen (Entra sign-in, unprovisioned boundary, callback, dev gate) | `7b612c3` | `ae466938` / `index-CylDR__H.js` |
| B3a registers | PageHeader/StatusBadge/states/register styles on People + Approvals; D.4/D.5 labels | `7dd9299` | `9d866107` / `index-DLNBZRbs.js` |
| B3b detail screens | Person profile + Approval detail; Breadcrumbs/DefinitionList/AuditTimeline; D.6 labels | `bbc42d5` | `57edf435` / `index-BAVhoSdW.js` |
| B3c governed actions | GovernedAction confirmation dialogs (B.15) on every governed mutation | `ecd602f` | `d78d5aac` / `index-mNxUSC98.js` |

**Owner visual confirmation on staging (2026-07-06):** signed in, populated People register (PER-0001) and Person profile (DefinitionList + AuditTimeline) rendering in the Command Desk design. Subsequent presentation evidence: the S1–S5 product-website capture set (sanitation-certified 2026-07-07) depicts these surfaces.

## Continuity

The foundation carried forward without regression into Sprint 35 (Members register + governed member dialogs, deployed `8059af35` / `index-Dljccol1.js`, owner-verified hosted 2026-07-07) — the design system's primitives (PageHeader, register styles, StatusBadge, GovernedAction, states) were reused unchanged, which is itself the strongest evidence the foundation is a foundation.

## Authoritative pointer for the Stage-4 gate

**This file.** Claim tier: hosted capability (the interface is deployed and exercised on staging) — public wording stays bounded by claim ceiling C7 ("Command Desk interface deployed on staging", presentation evidence).
