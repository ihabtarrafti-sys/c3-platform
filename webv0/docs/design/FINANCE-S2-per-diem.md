# Finance Sprint 2 — per-diem (and D-8 finally closes)

Second finance sprint, first CONSUMER of the money foundation. A per-diem is a
**daily rate** attached to a person's participation in a mission — money
metadata, direct-audited, kept SEPARATE from the governed roster (being on the
roster stays governed; the money on it is a direct edit).

## What shipped

- **Domain** (`mission.ts`): `MissionParticipant` gains `perDiemAmountMinor` +
  `perDiemCurrency` (nullable, move together). `missionDayCount(start, end)` —
  inclusive day span (null when open-ended). `setParticipantPerDiemInputSchema`
  (amount+currency paired, or both null to clear). Audit
  `MissionParticipantPerDiemSet`.
- **Capability** `canViewPerDiem` (owner/operations/finance/management —
  mirrors `canViewFinancials`). The read model **OMITS** per-diem entirely for
  everyone else (absence, not masking) — this is exactly CP **D-8**, now closed.
- **Migration 0018**: `per_diem_amount_minor` (bigint) + `per_diem_currency`
  (text) on `mission_participant`, with a currency CHECK and a paired-null CHECK
  (both set or both null — enforced at the DB too).
- Persistence (schema/mapper/writeTx.setParticipantPerDiem), use-case
  (`setParticipantPerDiem`, gated to `canManageMissions`, active-participant
  only, audited), api-contracts (participant DTO per-diem optional +
  `setParticipantPerDiem` input + `canViewPerDiem` in the me view), API route
  `POST /api/v1/missions/:missionId/participants/:personId/per-diem` with DTO
  gating on the participant list; openapi regen.
- **Web** (MissionDetailPage): a **Per-diem** column (visible only to
  `canViewPerDiem`) showing `RATE/day · TOTAL (Nd)` computed from the mission
  window; a **Per-diem…** action (owner/ops) to set or clear the daily rate
  (empty amount clears). Money is formatted via the S1 primitive.

## Evidence

Typecheck all projects; gate PASSED (413 tests incl. new per-diem domain tests
— day-count edges, paired-null validation — and persistence tests: set/clear +
audit + owner/ops gate + non-participant refusal). E2E 11/11 (missions spec sets
a per-diem and asserts the rate renders). The financial-omission (D-8) is proven
structurally: the field is absent from the wire for roles without canViewPerDiem.

## Ships with

The owner-requested **entity reactivate** (commit `c2bc1ac`) — deployed in the
same paste cycle (per-diem's migration + API covers both).

## Deploy

Migration 0018 (owner paste) → API (owner paste) → web (me).
