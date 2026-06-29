# C3 Architecture Baseline — Sprint 13

**Sprint:** Mission Finance: Financial Planning Spine  
**Version:** v0.13.0-finance  
**Date:** 2026-06-29  
**Status:** Frozen — approved at visual review

---

## What This Sprint Established

Sprint 13 adds the financial planning facet to Mission v2. The core question: *Can a Mission carry a lightweight financial plan that shows expected income, expected expenses, actuals, and settlement state without becoming a full accounting system?*

The answer is yes — with a clear boundary. The platform now carries budget intent and outcome tracking at the line level. It does not carry receipts, approval workflows, VAT, inter-entity transfers, or general ledger entries. The spreadsheet remains operational evidence; C3 carries the structural plan.

Sprint 13 also closes the FinancePending state: operators can now review the financial plan in context and approve it directly, transitioning the mission to Confirmed and activating ADR-002 obligations for all participants.

---

## The Finance Principle

> Mission Finance is not accounting. It is the conversation between financial intent and operational outcome.
>
> The question C3 answers: "Does this mission make financial sense at the planning stage, and did it perform as expected at settlement?"
>
> The question C3 does not answer: "What was the exact per-diem receipt for Day 3?"

---

## The Three Planning Layers (post-Sprint 13)

| Layer | Question | Source | Generates |
|---|---|---|---|
| Compliance | Does the participant hold required credentials? | `OperationalGap` | Credential/Journey WorkItems |
| Planning | Has the necessary preparation been done? | `MissionMilestone` | MilestoneAlert WorkItems |
| Finance | Is the financial plan approved and performing? | `MissionFinanceLine` | (v1: read-only display; WorkItems deferred) |

These three layers are independent. A mission can have all credentials current, all milestones complete, and a finance plan that is performing below budget — each facet carries its own signal without contaminating the others.

---

## Finance Data Model

### `FinanceLineDirection`

```typescript
'Income' | 'Expense'
```

### `FinanceLineCategory`

13 categories across two directions:

**Income (5):** `PrizeMoney` | `AppearanceFee` | `TravelReimbursement` | `Sponsorship` | `RevenueShare`

**Expense (8):** `RegistrationFee` | `Travel` | `Accommodation` | `PerDiem` | `PlayerFee` | `Equipment` | `Logistics` | `Contingency`

### `MissionFinanceLine`

```typescript
{
  LineID:         string;       // Deterministic ID: fl-{missionId}-{seq}
  MissionID:      string;
  Direction:      FinanceLineDirection;
  Category:       FinanceLineCategory;
  Description:    string;
  ParticipantID?: string;       // Present for person-linked lines (Travel, PerDiem, PlayerFee)
  PlannedAmount:  number;       // In Mission.OperatingCurrency
  ActualAmount?:  number;       // Undefined until settled; entered externally (v1)
  IsSettled:      boolean;      // Whether this specific line is financially closed
  Notes?:         string;
  CreatedAt:      string;       // ISO datetime
}
```

`MissionFinanceLine` is the only new finance entity in v1. All amounts are in `Mission.OperatingCurrency` — no cross-currency arithmetic.

### `MissionFinanceSummary` (computed, never stored)

```typescript
{
  totalLineCount:        number;
  settledLineCount:      number;
  totalPlannedIncome:    number;
  totalPlannedExpenses:  number;
  plannedNet:            number;   // totalPlannedIncome − totalPlannedExpenses
  totalActualIncome:     number;
  totalActualExpenses:   number;
  actualNet:             number;   // totalActualIncome − totalActualExpenses
  variance:              number;   // actualNet − plannedNet
  isFullySettled:        boolean;
  hasActuals:            boolean;  // true if any line has ActualAmount defined
}
```

Derived by `computeMissionFinanceSummary(lines)` in `financeUtils.ts`. Never stored. Re-derived from lines on every render via `useMemo`.

---

## Mission.OperatingCurrency

`Mission.OperatingCurrency?: 'USD' | 'AED' | 'SAR' | 'EUR'`

Replaces the abandoned `IncomeCurrency?` field. Single currency per mission in v1. All `MissionFinanceLine` amounts are denominated in this currency. The field is optional — missions without a finance plan may omit it.

---

## Finance Lifecycle via Mission.Status

No separate `FinanceStatus` field was added. `Mission.Status` already carries the financial lifecycle:

```
Planning → FinancePending → Confirmed → Active → PostMission → Settled
```

The FinancePending state carries two new operational meanings in Sprint 13:

1. **Visibility:** FinancePending missions now appear in the Situation Room scope selector, allowing operators to review the financial plan before approval.
2. **Action:** The "Approve & Confirm Mission" action is rendered on FinancePending missions, allowing manual promotion to Confirmed.

After approval, ADR-002 activates operational obligations for all participants.

---

## Settlement Model (v1)

Settlement is tracked at the **line level** (`IsSettled: boolean`), not at the mission level. A mission is considered fully settled when every line is settled (`isFullySettled = summary.isFullySettled`).

In v1, settlement marking is **not exposed through the UI**. `IsSettled` is set directly on the mock data or via future SharePoint write operations. The `settledLineCount` and settlement dot in the Finance section display the current state without allowing mutation.

---

## Service Architecture

### `IFinanceService`

```typescript
interface IFinanceService {
  listMissionFinanceLines(missionId: string): Promise<MissionFinanceLine[]>;
}
```

Read-only in v1. No create, update, or delete operations.

### Factory pattern (ADR-001)

```
useFinanceService() → IFinanceService
  dataSourceMode === 'sharepoint' → createSharePointFinanceService()  [graceful stub, returns []]
  else                            → createMockFinanceService()
```

---

## Hook Architecture

| Hook | Purpose | Cache key |
|---|---|---|
| `useFinanceService` | Parallel factory | — |
| `useMissionFinanceLines(missionId)` | Raw lines for FinanceSection | `finance.forMission(missionId)` |
| `useMissionFinanceSummary(missionId)` | Computed summary (composes from lines hook) | `finance.forMission(missionId)` |
| `useApproveMission` | Mutation: FinancePending → Confirmed | invalidates `mission.all()` + `mission.byId()` |

### Cache coherence

`useMissionFinanceSummary` composes from `useMissionFinanceLines`. Both hooks share the `finance.forMission(missionId)` cache key — **one network call, two consumers**. No second fetch regardless of how many components use either hook for the same mission.

```
useApproveMission.onSuccess
  → invalidate mission.all()         // scope selector refreshes; mission shows Confirmed
  → invalidate mission.byId()        // context header refreshes; approve bar disappears
  // finance.forMission() intentionally NOT invalidated — lines unchanged by status transition
```

---

## UI Architecture

### `FinanceSection` component

Self-contained, purely presentational. No hooks. Props: `{ lines, summary, currency }`. Returns null when `lines.length === 0`.

```
[Section header: "Financial Plan" + planned net]
[Column labels: PLANNED / ACTUAL]
[Income group header + income rows]
[Expense group header + expense rows]
[Summary strip: planned net · actual net · variance · settled N/N]
```

**`FinanceLineRow`**
```
[Category chip]  [Description + optional ParticipantID sub-label]  [Planned]  [Actual or —]  [Settled dot]
```
Actual colour: red when over-budget (expense only), green when under-budget (expense only), gray when absent.

**`GroupHeader`**: Direction label ("Income" / "Expenses") with group planned total.

**`FinanceSummaryStrip`**:
- Planned net: always shown (green if positive, red if negative)
- Actual net: shown if `hasActuals`; labelled "(partial)" if not all lines have actuals
- Variance: shown only when `allActualsKnown = lines.every(l => l.ActualAmount !== undefined)` — showing partial variance is misleading
- Settled: `settledLineCount / totalLineCount`

### `MissionContextHeader` — Finance pill (Sprint 13)

Finance net pill added to the metadata strip when `financeSummary` and `financeCurrency` are provided:

```
[Finance Pending]  [10 Mar – 15 Mar]  [|]  [1 participant]  [|]  [Net +﷼194,150]
```

Pill colour: green for positive net, red for negative, neutral gray for zero.

### `MissionContextHeader` — Approve & Confirm action bar (Sprint 13)

Rendered as a second row inside the header card when `onApprove` is provided (FinancePending missions only). Parent controls visibility by passing or omitting `onApprove`.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Saudi Arabia Regional Tournament 2026         Finance Pending               │
│  SATR/2026/003 · Rocket League · Saudi Arabia                               │
│                                  10 Mar–15 Mar │ 1 participant │ Net+﷼194K  │
├─────────────────────────────────────────────────────────────────────────────┤
│  Approving confirms the financial plan and activates operational obligations  │
│  for all participants.                         [Approve & Confirm Mission]   │
└─────────────────────────────────────────────────────────────────────────────┘
```

Button disables and shows "Confirming…" during mutation flight. The action bar disappears after the cache invalidation refetch returns Confirmed status.

### `SituationRoom` (extended — Sprint 13)

New data flows:
```
useMissionFinanceLines(selectedMissionId ?? '')   → financeLines, financeLinesLoading
useMissionFinanceSummary(selectedMissionId ?? '') → financeSummary
useApproveMission()                               → approveMission, isApprovingMission
```

`SELECTOR_STATUSES` extended to `['FinancePending', 'Confirmed', 'Active', 'PostMission']`.

`missionParticipantCount` fixed to use `selectedMission.ParticipantPersonIDs.length` (previously computed from gap person IDs, which returned 0 for FinancePending missions where ADR-002 gates obligations).

Render order in mission mode:
```
MissionContextHeader  (with finance pill + optional approve bar)
FinanceSection        (above milestones — higher-level context first)
MilestoneSection
Gap list
```

---

## Mock Data

### TR/2026/006 — RLCS 2026 World Championship (USD)

11 finance lines with realistic partial-actuals spread:

| Direction | Category | Description | Planned | Actual | Settled |
|---|---|---|---|---|---|
| Income | PrizeMoney | Prize pool allocation | $45,000 | — | — |
| Income | AppearanceFee | Guaranteed appearance fee | $10,000 | $10,000 | ✓ |
| Income | TravelReimbursement | Tournament travel reimbursement | $14,000 | $13,800 | — |
| Expense | RegistrationFee | Tournament entry fee | $2,500 | $2,500 | ✓ |
| Expense | Travel | Flights — PER-0001 | $3,400 | $3,580 | — |
| Expense | Travel | Flights — PER-0002 (visa pending) | $3,400 | — | — |
| Expense | Accommodation | Hotel — 8 nights team | $9,600 | — | — |
| Expense | PerDiem | Daily allowance — PER-0001 | $1,400 | — | — |
| Expense | PerDiem | Daily allowance — PER-0002 | $1,000 | — | — |
| Expense | Equipment | Peripherals and backup gear | $4,200 | — | — |
| Expense | Contingency | Contingency reserve | $5,000 | — | — |

**Planned net: +$38,500 USD**

Visual design intent: one income line with actual over-budget is not possible here (actuals ≤ planned for income — use expenses for over-budget drama). PER-0001 flights show $3,580 actual vs $3,400 planned → red actual colour.

### SATR/2026/003 — Saudi Arabia Regional Tournament (SAR)

7 finance lines, all draft (no actuals, none settled):

| Direction | Category | Description | Planned |
|---|---|---|---|
| Income | AppearanceFee | Guaranteed fee | ﷼75,000 |
| Income | PrizeMoney | Top-2 prize pool | ﷼150,000 |
| Expense | RegistrationFee | Entry fee | ﷼5,000 |
| Expense | Travel | Flights — PER-0004 | ﷼2,800 |
| Expense | Accommodation | Hotel accommodation | ﷼12,000 |
| Expense | PerDiem | Daily allowance — PER-0004 | ﷼1,050 |
| Expense | Contingency | Contingency reserve | ﷼10,000 |

**Planned net: +﷼194,150 SAR**

This mission is FinancePending, so the approve bar is visible.

---

## Frozen Decisions

1. **No separate FinanceStatus field.** `Mission.Status` already carries the financial lifecycle. `FinancePending` state carries the necessary gate semantics without schema expansion.

2. **`MissionFinanceLine` is the only new finance entity in v1.** No journal entries, no PO records, no receipt models, no approval request entities.

3. **`MissionFinanceSummary` is computed, never stored.** Derived from lines on every hook invocation via `useMemo`. Source of truth is always the line array.

4. **Single currency per mission (`OperatingCurrency`).** No cross-currency arithmetic in v1. All lines in the mission's operating currency.

5. **Settlement tracked at line level, not mission level.** `MissionFinanceLine.IsSettled` is the atomic unit. `isFullySettled` is a derived roll-up.

6. **Variance gated on all actuals known.** Partial variance is misleading. The summary strip only shows a variance figure when every line has an `ActualAmount`.

7. **`useApproveMission` does not invalidate finance cache.** The approval transition does not change finance lines. `finance.forMission()` remains valid across FinancePending → Confirmed.

8. **Approve bar is controlled by parent, not by component.** `MissionContextHeader` renders the approve bar when `onApprove` is provided; it does not inspect `mission.Status` internally. The parent (`SituationRoom`) is the single source of truth for when the action is available.

9. **`FinancePending` added to `SELECTOR_STATUSES`.** This is an intentional expansion beyond ADR-002 eligibility. FinancePending missions produce no operational gaps, but operators need to see the financial plan to review and approve it. The scope selector now carries two concerns: ADR-002 activation review + financial plan review.

10. **No Finance WorkItems in v1.** MilestoneAlert WorkItems cover the `Finance` milestone category (e.g., "Budget approved"). Dedicated FinanceAlert WorkItems (e.g., "Variance exceeds threshold") are deferred.

---

## What Remains Open

- **Finance line creation from UI** — operators cannot add or edit lines. All lines are seeded via mock or future SharePoint write. Deferred.
- **Actuals entry from UI** — `ActualAmount` is read-only in v1. Entry path (manual or SharePoint import) deferred.
- **Settlement marking from UI** — `IsSettled` is read-only in v1. Settlement action (per-line and bulk) deferred.
- **Finance WorkItems** — e.g., "Budget not approved N days before departure" → Immediate. Deferred to post-v1.
- **Multi-currency missions** — `OperatingCurrency` is single-value in v1. Multi-currency lines (e.g., per-diem in local currency) deferred.
- **Receipt / reimbursement approvals** — deliberately out of scope for v1 and likely deferred to a dedicated finance integration.
- **VAT / inter-entity transfers** — out of scope by design.
- **SharePoint FinanceLine list schema** — `SharePointFinanceService` is a graceful stub. Blocked on list design and IT provisioning.
- **PostMission finance review UX** — no dedicated settlement workflow. The Finance section is read-only in all mission states in v1.
