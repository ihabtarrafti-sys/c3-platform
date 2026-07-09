# S2 — Mission Finance Upgrade (C3 learns Geekay's tournament language)

Per `C:\Projects\C3-CONSOLIDATED-PLAN.md` Track A S2: the GK-Core mastersheet
reality and the frozen app's Mission Finance v1 design, merged into webv0.

## What shipped

1. **Mission identity**: `code` — the TOURNAMENT CODE, the org's universal join
   key (`SATR/2024/0001`, `TR/2025/004`), unique per tenant when present
   (friendly 409 + partial unique index) — plus `organizer` and `city`.
   Create/edit forms, register column, detail rows.
2. **Financial lifecycle**: `financeStage` — Planning → FinancePending →
   Confirmed → Active → PostMission → Settled (absorbs SP-era TD-26). One
   forward step at a time (direct-audited, version-guarded);
   **→Settled requires every income line Received** (checked in-tx). Legacy
   missions backfilled `Active`; new missions born `Planning`. Orthogonal to
   `isActive`.
3. **Line categories**: the merged taxonomy per direction —
   Income {PrizeMoney, AppearanceFee, Support, Sponsorship, RevenueShare,
   Buyout, Campaign, TravelReimbursement, Other}; Expense {RegistrationFee,
   Travel, Accommodation, PlayerFee, Equipment, Logistics, Contingency, Other}.
   **`PerDiem` is engine-owned**: never a manual line (double-count), but a
   legal EXPENSE BUDGET category — budget vs the rolled-in actual. Category is
   immutable (remove + re-add). Existing lines backfilled `Other`.
4. **Income payment tracking**: Expected → Invoiced → Received (corrections
   legal — the audit trail is the truth), with `receivedAmountMinor` (what
   actually landed), optional `receivedUsdPerUnit` (**the FX snapshot at
   receipt**), `paymentSourceLabel` (bank LABEL only — ESA, ADCB; never account
   numbers), and `refNo` (`FT2501475Z6Z`) for reconciliation. Expense lines
   carry none of it (DB CHECK). Audited `MissionLinePaymentSet`.
5. **Budgets**: `mission_budget` — one planned amount per (direction, category,
   currency), upsert-set like FX rates (clearing deletes the cell; the audit
   event is the history — the sole DELETE grant in the data plane, deliberate).
6. **P&L v2** (still a PURE derivation): income blends **PER LINE** — a
   Received line contributes its received amount, and its FX snapshot BEATS the
   live table (truth at receipt); expenses/per-diems blend per currency off the
   live table. NEW: `perCategory` budget-vs-actual rows with USD variance
   (nulls stay honest), and `settlement` {outstandingIncomeCount,
   incomeComplete}. All prior honesty rules hold.
7. **All-missions finance dashboard** (`/missions/finance`, the owner's literal
   ask): code, stage, Income/Expenses/Profit ≈ USD, outstanding count per
   mission. Line-based blends only — per-diem roll-in deliberately excluded
   from the SUMMARY (the per-mission page carries the full truth); documented
   in-code.
8. **Entity code rider**: `entity.code` (GKA, GKEC) — suggested from the name
   (`suggestEntityCode`, always editable), unique per tenant, friendly 409;
   feeds the per-entity invoice series in S6.

## Decisions recorded

- **Open-Q1 (code↔entity) answered by the data**: tournament codes derive from
  organizer/series, NOT the entity — fields stay independent; the ENTITY code
  feeds invoice series instead.
- **Cut loudly from S2**: per-diem presets (65/100 SAR, 25 USD quick-picks) —
  deferred to the Settings/expense-claims pass (S9); a Situation-Room
  "income outstanding" signal — the schema now carries everything it needs
  (one bulk read + one rule), queued as a cheap follow-up.
- The stored lifecycle follows the frozen design; settlement *completeness*
  stays derived (never stored) per the Expired-never-stored discipline.

## Defect found & fixed en route (product, not test)

`session.tsx#resolveMe` **cleared the stored session on ANY /me failure** —
including "the service could not be reached". A transient blip on reload
silently signed the user out (the addPerson E2E "flake" all along; the
hardening task's login-screen-after-reload signature proved it). Fix: only a
**401 (token rejected)** clears the session; transient failures retry once and
otherwise KEEP the stored session so a later refresh recovers. Fail-closed on
the right side now.

## Evidence

Typecheck 9/9. Gate PASSED — **466 tests** (+14: domain category/payment/budget
schemas + stage machine + received/snapshot blend + variance + settlement;
persistence payment walk + budget upsert/clear audit + stage walk with the
settle guard + org summary + per-tenant code uniqueness; api the full S2 route
walk with honest-null variance → rate set → variance appears, gating). E2E
**11/11 full-suite** (missions.spec: Expected→Received with received amount +
profit following, budget variance row, stage advance, the dashboard row;
entities.spec: code suggestion GU; visitor: dashboard fails closed) — including
addPerson passing IN the full run with the session fix.

## Deploy

Migration 0023 (owner paste) → API (owner paste) → web (me). Pastes:
`C:\Projects\C3-S2-DEPLOY-PASTES.md`.
