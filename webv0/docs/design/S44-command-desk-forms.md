# S44 — Command Desk forms and dialogs

**Sprint intent (owner, 2026-07-08):** "the buttons and stuff when creating looks
very basic and not up to par with the vision we put." S44 is the design-elevation
pass the post-parity roadmap promised. It changes HOW the product looks and
feels; it changes nothing about what it does. The sprint gate is the owner's
visual review, not a test count — but the standing constraint still applies:
zero testid/behavior changes, 9/9 E2E must hold (and does).

## What shipped

### 1. `FormPanel` — the register form surface

`apps/web/src/components/FormPanel.tsx`. Every create form in the product
(7 pages) previously rendered as a bare Fluent `Card` with fields stacked
inside — functional, anonymous, "very basic." FormPanel replaces it with a
surface that states what kind of act the user is about to perform:

- **Eyebrow** — small-caps label naming the act ("NEW AGREEMENT", "ADD PERSON").
- **Mode chip** — the honesty marker, top right:
  - `governed` → **"Governed request"** chip + 3px Command-Black left rail.
    This form does not change the world; it asks permission to.
  - `direct` → **"Immediate · recorded"** chip + ink left rail. This form
    changes the world now, and says so.
- **Intro line** — one sentence of consequence, carried over from the old forms.
- **Footer** — hairline-separated, paper-white strip holding the submit
  action, so the commit point reads as a distinct zone rather than another row.

Surface: identity-white on the paper-white page, hairline border,
`--c3-radius`, `--c3-e1`. The governed/direct distinction is structural in the
visual language now — the same split the API enforces.

Converted pages (eyebrow / mode):

| Page | Eyebrow | Mode |
| --- | --- | --- |
| PeoplePage | Add person | governed |
| CredentialsPage | Add credential | governed |
| JourneysPage | Initiate journey | governed |
| AgreementsPage | New agreement | governed |
| MembersPage | Provision member | governed |
| EquipmentPage | Add kit/apparel item | direct |
| MissionsPage | New mission | direct |

### 2. `GovernedAction` dialog surface

The confirm dialog is the single most-used control in the product — every
governed submit and every direct-audited transition passes through it. It now
carries the Command Desk signature: 3px Command-Black top rail, `--c3-radius`,
`--c3-e2` elevation, 480px max width, 17px/600 title, and the description set
off by a 2px hairline left rule (the "consequence paragraph" reads as a quoted
statement of what is about to happen). Actions sit on a hairline-top row.

Style only. The component fronts both governed submits and direct confirms, so
the surface itself makes no governed/direct semantic claim — the trigger label,
title, and description continue to carry that honestly, per-call-site.

### 3. Token unification

SituationRoomPage carried hardcoded fallback values from its S43 debut
(`rgba(15,15,16,…)` variants). All replaced with the canonical `--c3-*` tokens
(`--c3-identity-white`, `--c3-radius`, `--c3-e1`, rails =
`--c3-signal-red` / `--c3-status-pending` / `--c3-ink-35` / `--c3-hairline`).
Dead `form`/`formIntro` makeStyles keys removed from the five pages that no
longer use them.

## What deliberately did NOT change

- No testid added, removed, or renamed. No DOM-order change that any spec
  observes. 9/9 E2E green before and after.
- No route, contract, capability, or API change — this is a web-only deploy
  (no migration paste, no API paste).
- The wording of every consequence sentence ("…is not created until an owner
  executes it") is untouched; S44 changes the frame, not the claims.

## Evidence

- Typecheck: all projects. Gate: PASSED (incl. entra-bundle dev-auth scan).
- E2E: 9/9 on the final tree (list reporter, 1 worker, shared stack).
- Visual self-check: 4 screenshots against the local stack (governed form,
  direct form, confirm dialog, Situation Room) reviewed before the owner sees
  staging.

## Gate

The owner's eyes, on staging. If it doesn't look "up to par with the vision,"
the sprint is not done — iterate on this foundation.
