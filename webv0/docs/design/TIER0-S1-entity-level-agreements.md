# Tier-0 Sprint 1 — person-less entity-level agreements

The S48 fast-follow, greenlit as Tier-0 #1 (2026-07-10). Org-to-org paper —
sponsorships, partnership fees, venue MOUs — is real Geekay money (the P&L now
records partnership income), but every agreement previously REQUIRED a person.
Now an agreement is anchored to a person, an entity, or both.

## THE ANCHOR RULE (load-bearing)

`personId` is nullable; **an agreement needs an anchor: a person or an entity,
at least one — never neither.** Enforced three deep: the input schema refine
(submit-time 400), the use-case existence checks per given anchor, and the DB
`agreement_anchor_check` CHECK (migration 0022). Every existing row already has
a person and is untouched.

## The sentinel (no fake people)

`Approval.targetPersonId` is NOT NULL by design (write-once column). Entity-level
agreement operations carry the **`N/A-ENTITY`** sentinel (`ENTITY_AGREEMENT_TARGET`,
the `N/A-MEMBER` precedent) — truthful, never a fake PER id, and person-scoped
approval reads (the person hub) never match it. Applied at AddAgreement submit
and inherited by Renew/Terminate + the three governed term ops
(`agreement.personId ?? ENTITY_AGREEMENT_TARGET`).

## What changed (every layer)

- **Domain**: `Agreement.personId: string | null`; `addAgreementInputSchema`
  person optional + anchor refine; `ENTITY_AGREEMENT_TARGET`.
- **Migration 0022**: `person_id DROP NOT NULL` + the anchor CHECK. The
  composite FK stays (a NULL person_id is simply unenforced — MATCH SIMPLE).
- **Application**: submit checks each GIVEN anchor exists; sentinel targets;
  executor + audit notes name the entity when there is no person.
- **Situation Room**: entity-level renewal windows get an org-voice headline
  ("The Sponsorship (AGR-0003) ends in N days"), no roster reasoning (no person
  to be rostered), and a person-free RenewAgreement action (the web already
  routes by agreementId).
- **Web**: Add Agreement — Person is optional (explicit "No person —
  entity-level" choice); Entity hint says required-when-no-person; the submit
  stays disabled while anchored to nothing. Register person cell renders "—";
  the detail gains an **Entity row** (name lookup) and shows "— (entity-level)"
  for the person. Approval detail subject: "Sponsorship for ENT-0001".

## Evidence

Typecheck all 9 projects. Gate PASSED — **452 tests** (+4: the anchor rule at
the schema; the governed entity-level round-trip with the sentinel visible; the
anchored-to-nothing refusal; the wire 400). E2E **11/11 first run** —
entities.spec now walks it in the browser: submit disabled with no anchor,
entity picked, owner executes off the "Sponsorship for ENT-0001" subject, the
register shows the person-less row and the detail names the entity.

## Deploy

Migration 0022 (owner paste, two statements) → API (owner paste) → web (me).
Deploy pastes: `C:\Projects\C3-TIER0-S1-DEPLOY-PASTES.md`.
