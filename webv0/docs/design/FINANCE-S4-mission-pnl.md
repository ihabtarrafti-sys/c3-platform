# Finance Sprint 4 — mission P&L (the finance layer's finale)

The owner's question from the make-C3-whole session: *"expenses cost against how
much income (prize + org support/partnership fees etc..) we're gonna make as gk
(profit)."* This sprint answers it per mission.

## The model

- **`mission_line`** (PNL-XXXX): one INCOME or EXPENSE line on a mission —
  direction + label ("Prize — 2nd place", "Flights") + amount in **native
  currency** (integer minor units). Direction is immutable (remove + re-add to
  flip). Soft removal (no DELETE grant). Migration 0021 (RLS ENABLE+FORCE,
  composite FK → mission, amount>0 + currency + direction CHECKs).
- **Per-diem roll-in**: every ACTIVE participant with a daily rate (Finance S2)
  contributes `rate × inclusive mission days` as an expense — automatically,
  no re-entry. Removed participants' rates are dormant history.
- **The P&L is a pure READ-SIDE derivation** (`computeMissionPnl`, domain):
  per-currency native subtotals + a USD blend via the org's FX table (S1),
  converted per currency-subtotal to minimize rounding. **Nothing computed is
  stored.**

## Honesty rules (load-bearing)

- **Missing rate → NO blended figure at all** (all-or-nothing; a partial sum
  would silently misstate profit). The culprits are named
  (`missingRates: ['SAR']`) and the UI points at Settings → Exchange rates.
- **Open-ended mission → per-diem totals excluded** and flagged
  (`perDiem.openEnded`); each entry shows its daily rate only. Setting the end
  date brings them into the totals.
- Blended figures render with **≈** — display-level conversion, never books.

## Governance

Lines are **DIRECT-BUT-AUDITED** (the per-diem/mission-shell posture): they
RECORD operational facts, unlike agreement terms, which are COMMITMENTS to
people and therefore governed (S3.5). Forcing an approval per hotel receipt
would be bookkeeping friction, not control. Writes = `canManageMissions` +
`canViewFinancials` (belt-and-braces); version-guarded; audited same-tx on the
Mission trail (`MissionLineAdded/Updated/Removed`). Lines attach only to an
ACTIVE mission; a retired shell's P&L is frozen but readable. **The whole P&L
surface (read) is gated to `canViewFinancials`** — legal/hr/visitor get a
section-level 403 / absent panel, never fake zeros.

## What shipped (every layer)

Domain (`missionLine.ts`: schemas, `computeMissionPnl`, PNL id, audit actions) ·
migration 0021 (+export/exit bundles, db.test list) · persistence
(schema/mapper/stores.listMissionLines/writeTx CRUD) · application
(`missionPnlOps.ts`: getMissionPnl assembling lines+roster+rates → the pure
derivation; add/update/remove with changed-fields-only audit) · api-contracts
(line + pnl DTOs) · api (`GET /missions/:id/pnl`, `POST …/lines`,
`POST …/lines/:lineId`, `POST …/lines/:lineId/remove`) · web
(MissionDetailPage **Profit & loss** section: lines table + per-diem rows +
per-currency subtotals + `Income/Expenses/Profit ≈ USD` or the missing-rate
notice; Add/Edit/Remove confirms).

**Defect caught by E2E during the build**: the shell edit (dates) didn't
invalidate the P&L query — stale day counts. Fixed: mission-level invalidation
now includes `missionPnl` (shell dates and per-diems are P&L inputs).

## Evidence

Typecheck all 9 projects. Gate PASSED — **448 tests** (+14: domain derivation
edges — multi-currency blend, missing-rate all-or-nothing, open-ended exclusion,
active-only roll-in, empty-mission zeros; persistence CRUD + changed-fields
audit + gates + active-only + RLS + the FULL assembly with a governed
participant; api routes + rate-appears-blend-appears + finance-reads/legal-403).
E2E **11/11** — missions.spec walks the P&L in the browser: per-diem shown
rate-only while open-ended, income+expense lines added, `Profit ≈ USD 8,000.00`,
line edit → 7,500, remove → 10,000, then after the end date lands on a retired
shell: `× 15d = SAR 3,750.00` with the missing-SAR notice; visitor sees no
panel.

## Deploy

Migration 0021 (owner paste) → API (owner paste) → web (me). Deploy pastes:
`C:\Projects\C3-FINANCE-S4-DEPLOY-PASTES.md`.
