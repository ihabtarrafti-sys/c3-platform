# S7 — Teams Domain (Track A)

**Status: BUILT + CERTIFIED, not yet deployed** (owner away; deploys batch at
his return) · migration `0027`

GK-Core runs its entire P&L "per TEAM/GAME with ROI%" — LOL/R6/RL/HOK plus
Operations/Content/Creatives — and person codes are structured GAME/ROLE/NNN
(`R6/PL/007`). Until now `person.currentTeam` was free text. S7 makes the
structure first-class and derives the org's #1 real report from money that
already exists.

## The model

- **Team** (`TEAM-XXXX`): a **game division** (fields rosters, competes, owns
  tournament money) or a **department** (staff structure). The short **CODE**
  (R6, HOK, OPS — required, unique per tenant, uppercased at the boundary) is
  the reporting key: it heads the per-team report and numbers the structured
  person codes.
- **Membership**: one row per (team, person) with the mission-participant
  reactivation pattern — flips, never deletes; re-adding a former member
  reuses the row with the new role. Reads join the person's display name.
- **Mission team tag** (`mission.team_id`, nullable): the division that
  fielded the event. Guarded — a tag must name a real, ACTIVE division. This
  single column is what makes per-team P&L derivable; no second ledger.

## Posture

Direct-but-audited (org structure records facts — the entity-register
standing). Writes gated `canManageEntities` (owner/operations, the
org-structure grant); reads ride the baseline person read. The money view is
separately gated `canViewFinancials`.

Deliberately NOT governed: team roster moves are operational structure. The
commitments live where they always did — agreements. (Governed roster moves
remain a tightening option if the owner ever wants sign-off per signing.)

## The report: per-team P&L + ROI%

`GET /api/v1/teams/:id/finance` aggregates the blended per-mission P&Ls of
the missions tagged to the team (the finance-dashboard read shape: lines-only
blending; each mission's own page carries the per-diem roll-in). The
aggregation is **honest-null one level up**: if ANY tagged mission cannot
blend to USD (missing FX rate), the team total is **null** and the culprit
missions are named — a partial sum would be a lie. `ROI% = profit / expense`
in basis points; **no expense base → no ratio** (the profit column already
tells the story; zero-spend "infinite ROI" is noise, not insight).

## Structured person codes

`suggestPersonnelCode(teamCode, role, takenCodes)` proposes the next
`{CODE}/{ROLE}/{NNN}` (GK-Core role abbreviations: PL/CH/TM/AN…; unknown
roles take their first letters). Shown in the add-member dialog as a
**copyable suggestion only** — `person.personnelCode` stays free-text truth,
because V1 has no person-update surface. When one exists, "apply code" is a
one-button upgrade.

## Signals ship with features

**TeamUnstaffed** (watch band, impact 1 × urgency 1): an ACTIVE game division
with no active members — a structure that fields nothing. Departments are
exempt (staff structure isn't "fielded"); deactivated divisions are exempt
(the register already says so). The cockpit ledger grows to 10 checks.

## Surfaces

- **Teams register** (`/teams`, nav for everyone; manage actions gated):
  code/name/kind/game/status; create drawer with code suggestion from name.
- **Team page**: definition list; roster with add (person picker + role +
  code suggestion) / remove (reactivation on re-add); the P&L report
  (finance-gated) with per-mission rows, totals, ROI, and the named-culprit
  notice when unblendable; audit history.
- **Missions**: create form and shell edit gain the division picker
  (active GameDivisions only); mission page shows the team as a link.
- **Person page**: active team memberships as links, `currentTeam` relabeled
  "Team (display)" — the memberships are the authoritative structure.

## Evidence

- `packages/domain/test/team.test.ts` — code suggestion series math,
  role abbreviations, honest-null aggregation + ROI (incl. zero-expense and
  empty-team), input contracts.
- `packages/domain/test/situation.test.ts` — TeamUnstaffed fires only for
  active, unstaffed GameDivisions.
- `apps/api/test/teams.test.ts` — CRUD + duplicate code 409; roster
  add/dup-409/remove/reactivate; person-hub read; mission tag (404 missing,
  409 inactive); per-team finance totals + ROI 2500 bps; missing-SAR-rate →
  null totals with the culprit named → rate set → whole again; the unstaffed
  signal appearing and clearing; update/deactivate/reactivate; audit actions;
  visitor gates (read yes, write 403, finance 403).
- `apps/web/e2e/teams.spec.ts` — the human walk (runs LAST on the shared
  stack): create TST → roster add with `TST/PL/001` suggested → tag the
  settled Invoice Cup mission → the report shows it with USD totals and the
  honest no-expense-base ROI note → visitor sees structure, never money.
