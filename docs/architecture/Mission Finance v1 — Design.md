# Mission Finance v1 — Design Document

**Author:** C3 Architecture  
**Date:** 2026-06-29  
**Status:** Draft — pending Sprint 13 approval  
**Supersedes:** Nothing (first Finance design document)

---

## The Design Question

Can a Mission carry a lightweight financial plan that shows expected income, expected expenses, actuals, and settlement state — without becoming a full accounting system?

**The answer is yes.** Through a `MissionFinanceLine` record per budget item and a computed `MissionFinanceSummary`, C3 can model the full financial arc of a Mission — from budget proposal to settlement — without owning reconciliation, approval workflows, or accounting ledgers.

The key architectural insight: Mission.Status already carries the financial lifecycle. `Planning → FinancePending → Confirmed → Active → PostMission → Settled` is not just an operational progression — it is also a financial one. The design respects this rather than introducing a parallel Finance state machine.

---

## What This Is Not

These are explicit non-goals for v1 and potentially for all time:

- **Not a general ledger.** No double-entry bookkeeping. No chart of accounts.
- **Not an expense reimbursement system.** No receipt upload, no approval chains, no reimbursement routing.
- **Not a multi-entity accounting system.** No VAT, no inter-company transfers, no tax treatment.
- **Not a payment gateway.** C3 does not initiate or track bank transfers.
- **Not a payroll system.** Player fees are planning records, not payroll entries.
- **Not the Excel spreadsheet rebuilt.** The spreadsheet is operational evidence — the source of requirements, not the architecture.

The discipline question to apply to any proposed feature: *Does this help Ops answer "will this mission make financial sense?" or does it help Finance reconcile accounts?* C3 Finance answers the first question. The second is for the finance system.

---

## What the Spreadsheet Tells Us

The original tournament budget sheet shows:

| Row | Type | Maps to |
|---|---|---|
| Prize money | Income | `PrizeMoney` line |
| Appearance fee | Income | `AppearanceFee` line |
| Travel reimbursement | Income | `TravelReimbursement` line |
| Tournament registration | Expense (mission) | `RegistrationFee` line |
| Player fees | Expense (per-participant) | `PlayerFee` line × participants |
| Flights | Expense (per-participant) | `Travel` line × participants |
| Hotel | Expense (mission) | `Accommodation` line |
| Per diem | Expense (per-participant) | `PerDiem` line × participants |
| Equipment | Expense (mission) | `Equipment` line |
| Contingency | Expense (mission) | `Contingency` line |
| Net P&L | — | Computed `MissionFinanceSummary.plannedNet` |

The spreadsheet's rows become `MissionFinanceLine` records. Its totals become computed summary fields. Nothing in the spreadsheet structure implies accounting — it implies planning. The architecture follows that implication.

**Critical observation:** The spreadsheet is asking *"will we make money on this?"* and *"are we staying in budget?"* C3 should answer exactly those questions through structured records instead of cells.

---

## How Mission.Status Already Models the Financial Lifecycle

The existing Mission type carries the full financial arc in its lifecycle:

```
Planning      — Under consideration. No financial commitment. No lines expected.
FinancePending — Budget proposed. Finance lines may be drafted. Awaiting approval.
Confirmed      — Finance approved. Obligations activate (ADR-002). Lines are frozen.
Active         — Mission in progress. Actuals begin arriving.
PostMission    — Event ended. Actuals being recorded. Settlement pending.
Settled        — All accounts closed. Lines fully settled. Mission archived.
```

**This means C3 does not need a separate `FinanceStatus` field on Mission.** Mission.Status is the financial status. The design respects this by not introducing a parallel state machine.

What the Finance layer adds is not new Mission status — it is content at each status: the lines, amounts, and settlement records that give operational meaning to the status transitions.

---

## The Two-Layer Answer

### Layer 1: What belongs on Mission itself

Mission gains one new field:

```typescript
// New field on Mission
OperatingCurrency: 'USD' | 'AED' | 'SAR' | 'EUR';
```

This supersedes the existing `IncomeCurrency?` field, which was a partial model of the same concept. `OperatingCurrency` applies to all finance lines for the mission — income and expense alike. In v1, all lines for a mission use this single currency. Multi-currency conversion is deferred.

Everything else the Finance view needs is computed from MissionFinanceLine records. Nothing about totals, variances, or settlement completeness is stored on Mission.

### Layer 2: What belongs as MissionFinanceLine records

One record per budget item. Income and expense lines coexist under the same entity.

```typescript
// types/finance.ts

export type FinanceLineDirection = 'Income' | 'Expense';

export type FinanceLineCategory =
  // Income
  | 'PrizeMoney'           // Tournament prize pool allocation
  | 'AppearanceFee'        // Organiser appearance payment
  | 'TravelReimbursement'  // Organiser-covered travel costs
  | 'Sponsorship'          // Sponsor funding for this mission
  | 'RevenueShare'         // Streaming / content rights revenue
  // Expense
  | 'RegistrationFee'      // Tournament or league entry fee
  | 'Travel'               // Flights — mission-level or per-participant
  | 'Accommodation'        // Hotel — mission-level or per-participant
  | 'PerDiem'              // Daily allowance — per-participant
  | 'PlayerFee'            // Player appearance / participation fee
  | 'Equipment'            // Hardware, peripherals, team gear
  | 'Logistics'            // Freight, customs, local transport
  | 'Contingency';         // Reserve buffer — unallocated expense headroom

export interface MissionFinanceLine {
  LineID:        string;
  MissionID:     string;
  Direction:     FinanceLineDirection;
  Category:      FinanceLineCategory;
  Description:   string;
  /**
   * ParticipantID links this line to a specific Mission participant.
   * Null / undefined means mission-level (applies to the whole delegation).
   *
   * Participant-linked lines: Travel (per-person flight), PerDiem,
   *   PlayerFee, sometimes Accommodation (per room / per person).
   * Mission-level lines: RegistrationFee, Equipment, Logistics,
   *   Contingency, group Accommodation, prize/income lines.
   */
  ParticipantID?: string;
  /** Planned amount in Mission.OperatingCurrency. Always set. */
  PlannedAmount:  number;
  /**
   * Actual amount in Mission.OperatingCurrency.
   * Null until known. Set when the money has moved or an invoice is received.
   * A line can be partially known (estimated planned, actual confirmed later).
   */
  ActualAmount?:  number;
  /**
   * True when the money has definitively moved:
   *   Expense: payment made (PO issued, wire confirmed, etc.)
   *   Income:  funds received
   * In v1: set manually by the operator. No payment system integration.
   */
  IsSettled:      boolean;
  Notes?:         string;
  CreatedAt:      string;
}
```

---

## Participant-Linked vs Mission-Level Lines

The `ParticipantID` link is the mechanism for per-person financial planning. It enables:
- Per-player travel cost tracking
- Per-player per diem computation (cross-reference with `MissionParticipant.PerDiemRate`)
- Player fee records per person
- Participant-level cost summary in the UI

**When to use participant-linked:**
- `Travel` — one line per person (flight costs differ)
- `PerDiem` — one line per person (rate differs by role)
- `PlayerFee` — one line per person (contract values differ)
- `Accommodation` — can be per-person or mission-level depending on billing structure

**When to use mission-level (no ParticipantID):**
- `RegistrationFee` — flat mission cost
- `Equipment` — team gear shipped as one batch
- `Logistics` — freight, customs — billed to mission
- `Contingency` — unallocated buffer
- Income lines — PrizeMoney, AppearanceFee, Sponsorship are mission receipts, not per-person

**Design decision rationale:** A `ParticipantID` on the line is simpler than a separate `MissionParticipantBudget` entity. It avoids a third entity, still supports per-player breakdowns, and can be upgraded to a richer participant budget model in a later sprint without a breaking schema change.

---

## Computed State: MissionFinanceSummary

Computed at query time from the raw lines. Never stored.

```typescript
// Returned by useMissionFinanceSummary — computed in financeUtils.ts

export interface MissionFinanceSummary {
  /** All lines in the plan */
  totalLineCount: number;
  /** Lines where IsSettled = true */
  settledLineCount: number;
  
  // --- Planned ---
  totalPlannedIncome:    number;  // sum of PlannedAmount for Income lines
  totalPlannedExpenses:  number;  // sum of PlannedAmount for Expense lines
  plannedNet:            number;  // totalPlannedIncome - totalPlannedExpenses

  // --- Actuals (partial until PostMission) ---
  totalActualIncome:     number;  // sum of ActualAmount for Income lines (0 if null)
  totalActualExpenses:   number;  // sum of ActualAmount for Expense lines (0 if null)
  actualNet:             number;  // totalActualIncome - totalActualExpenses

  // --- Variance ---
  /**
   * How actuals are tracking against plan.
   * Positive = better than plan (higher income or lower expenses).
   * Negative = worse than plan.
   * Partial and unreliable while ActualAmount is missing on most lines.
   * Becomes meaningful in PostMission once most actuals are entered.
   */
  variance:              number;  // actualNet - plannedNet

  // --- Settlement ---
  isFullySettled:        boolean; // settledLineCount === totalLineCount
  hasActuals:            boolean; // any ActualAmount is set
}
```

**Key invariant:** `MissionFinanceSummary` is always derived from the lines. If a line is updated, the summary updates automatically on the next query. No denormalization.

---

## The FinancePending → Confirmed Gate

### Current mechanism (pre-Finance v1)

`FinancePending` already exists in `MissionStatus`. Currently, the transition to `Confirmed` is modelled but has no C3 trigger — it would be an external decision recorded by editing Mission status.

### Finance v1 mechanism

Sprint 13 adds an explicit **"Approve & Confirm"** action in the Situation Room, visible when:
- `Mission.Status === 'FinancePending'`
- The operator is viewing the Finance section

What this action does:
1. Sets `Mission.Status → 'Confirmed'`
2. Sets `Mission.ConfirmedAt` and `Mission.ConfirmedBy`
3. Invalidates the mission cache
4. The ADR-002 activation gate triggers: obligations begin generating for participants

In v1 this is an unconditional one-click confirmation — the operator reviews the finance plan and decides. There is no automated gate (e.g., "all income lines must exist" or "budget within ceiling").

**Why unconditional in v1:** The financial plan at FinancePending may be incomplete — a mission might be confirmed with a rough expense estimate while income is still being negotiated. Requiring completeness would create false gates. The operator's judgment is the gate.

**Later:** Optional approval thresholds — "cannot confirm unless PlannedNet > 0" or "requires Finance Manager sign-off". These are gates that require knowing business rules we don't have yet.

### Why this works without a separate FinanceStatus

The question "has this mission's budget been approved?" is answered by `Mission.Status >= 'Confirmed'`. No separate field needed.

The question "is the financial plan complete?" is answered by `MissionFinanceSummary` (are all lines filled in, are actuals entered, is settlement done?). This is a computed view, not a stored state.

---

## Settlement Model

Settlement tracks whether money has definitively moved.

**Per-line settlement:** `MissionFinanceLine.IsSettled = true` means:
- Expense: payment has been made
- Income: funds have been received

**Mission-level settlement:** `MissionFinanceSummary.isFullySettled` = all lines settled.

**The `Settled` Mission.Status** is manually set by the operator, after reviewing the settlement summary, when all accounts are closed. C3 surfaces the summary ("N of N lines settled") but does not auto-transition.

**What settlement is not:**
- Not a payment confirmation system (no bank reference, no wire confirmation)
- Not a receipt management system (no file attachments in v1)
- Not an approval chain (one-click per line, set by the operator)

**v1 settlement surface:** A toggle or "Mark Settled" button per line in the Finance section. Same pattern as "Mark Complete" in MilestoneSection.

---

## Currency

**v1 rule:** One `OperatingCurrency` per mission. All lines in that currency. No conversion.

```typescript
// Added to Mission
OperatingCurrency: 'USD' | 'AED' | 'SAR' | 'EUR';
```

This supersedes `Mission.IncomeCurrency?` (currently optional). Implementation will migrate the field name. The type union stays the same.

**Common cases:**
- EWC / international tournament: `USD` (prize pools and appearance fees denominated in USD)
- UAE-based events: `AED`
- KSA missions (SATR/ prefix): `SAR`

**Why defer multi-currency:** Line-level currency + conversion requires exchange rate management, historical rates for actuals, and rate-variance reporting. This is a meaningful accounting feature, not planning. Deferred indefinitely.

**The gap this creates:** If flights are billed in EUR and accommodation in USD for a USD-currency mission, the operator converts manually before entering the line. This is the same thing they do in the spreadsheet. Acceptable for v1.

---

## WorkItem Implications (Eventual — Not Sprint 13)

When Finance WorkItems are built, they should slot into the generation pipeline as Step 6 (after MilestoneAlert at Step 5):

| Trigger | Category | Priority | Timing |
|---|---|---|---|
| Mission Status = FinancePending, departure ≤ 21 days, no lines | `FinanceAlert` | High | Pre-departure |
| Mission Status = FinancePending, departure ≤ 14 days, lines in Draft | `FinanceAlert` | High | Pre-departure |
| Mission Status = PostMission, lines with no actuals after 14 days | `FinanceAlert` | Normal | Post-event |
| Any line: ActualAmount > PlannedAmount × 1.25 (>25% overage) | `FinanceAlert` | Normal | Any time |
| Mission Status = PostMission, unsettled lines after 30 days | `FinanceAlert` | Normal | Settlement |

These are design stubs. Sprint 13 does not implement WorkItem generation for Finance. The data model will be ready for it.

The WorkItemTrigger variant for Finance:

```typescript
{
  type:               'FinanceGap';
  missionId:          string;
  missionName:        string;
  lineId?:            string;   // null for mission-level alerts
  reason:             'NoBudget' | 'DraftOnly' | 'OverBudget' | 'SettlementDue' | 'ActualsMissing';
  daysUntilDeparture: number;
}
```

---

## What is Stored vs Computed

| Field | Stored | Computed |
|---|---|---|
| `MissionFinanceLine.LineID` | ✅ | |
| `MissionFinanceLine.PlannedAmount` | ✅ | |
| `MissionFinanceLine.ActualAmount` | ✅ (optional) | |
| `MissionFinanceLine.IsSettled` | ✅ | |
| `MissionFinanceSummary.totalPlannedIncome` | | ✅ |
| `MissionFinanceSummary.plannedNet` | | ✅ |
| `MissionFinanceSummary.variance` | | ✅ |
| `MissionFinanceSummary.isFullySettled` | | ✅ |
| `Mission.OperatingCurrency` | ✅ | |
| `Mission.Status` (financial lifecycle) | ✅ | |
| Finance section "approved" state | | ✅ (= `Mission.Status >= 'Confirmed'`) |

Nothing about financial totals or health is stored. Everything is derived on query. This means:
- Correcting a planned amount immediately corrects all summaries
- No sync bugs between summary and detail
- No migration needed when logic changes

---

## Key Design Tradeoffs

### 1. Line-level IsSettled vs Mission-level settlement

Chosen: line-level. Gives the operator visibility into which specific items are still open. The mission-level summary (`isFullySettled`) is derived from line-level state, not separately tracked.

Trade: operators must mark each line. For a mission with 15 lines, that is 15 actions. Later: bulk-settle button for all income lines at once (e.g., when prize wire arrives).

### 2. ParticipantID on line vs separate MissionParticipantBudget entity

Chosen: `ParticipantID` on the line. Simpler schema, no new entity, supports per-player breakdowns without a join table. The cost: no natural "total budget per participant" computed object — that must be aggregated from lines at query time.

Later: if per-participant budget planning becomes a first-class feature (separate view, approval per participant), a `MissionParticipantBudget` entity would make sense. Premature now.

### 3. FinanceStatus on Mission vs FinanceStatus field

Chosen: no new field. `Mission.Status` already encodes the financial lifecycle. Adding `FinanceStatus` would be a parallel state machine that would immediately diverge from `Mission.Status` in practice. Operators would see two states and be unsure which governs.

The key insight: the only finance state C3 needs to track beyond what `Mission.Status` provides is *how complete the lines are* — and that is a computed view from the lines themselves.

### 4. ActualAmount on the same record vs separate actuals records

Chosen: `ActualAmount?` on `MissionFinanceLine`. Event-sourced actuals (separate records per amount change) would give an audit trail (who entered what, when). The cost is significant model complexity. In v1, operators enter actuals once; corrections overwrite. No audit trail in v1.

Later: `ActualAmount` history could be stored as a `FinanceLineRevision[]` if Finance needs an audit trail for external reporting.

### 5. OperatingCurrency mandatory vs optional

Chosen: mandatory on Mission from Sprint 13 onward, with a migration path for existing mock missions. The existing `IncomeCurrency?` field is the predecessor — it will be renamed and made required. Missions without OperatingCurrency cannot have finance lines.

---

## v1 vs Later

### Sprint 13 builds

- Full type system (`types/finance.ts`, `Mission.OperatingCurrency`)
- Mock service with seeded lines for TR/2026/006 (8–10 lines, covering both income and expense, participant-linked and mission-level, mix of with/without actuals)
- Hook layer: `useMissionFinanceLines`, `useMissionFinanceSummary`
- Situation Room Finance section: **read-only list** — lines, summary strip, "Planned / Actual / Variance" row
- Finance pill in `MissionContextHeader` (planned net, status-tinted)
- "Approve & Confirm" action for FinancePending missions

### Sprint 13 does NOT build (explicitly deferred)

- Line creation from UI (lines seeded in mock only)
- Line editing from UI
- Actuals entry from UI
- Settlement marking from UI
- WorkItem generation for Finance
- Multi-currency support
- Receipt / document attachments
- Participant-level cost summary view (available in data, not surfaced in UI yet)

### Later sprints

- **Actuals entry UI** — operators update `ActualAmount` as invoices arrive. Same line, overwrite.
- **Settlement marking UI** — per-line "Mark Settled" in Finance section.
- **Line creation UI** — add lines for a mission directly in the Situation Room.
- **Finance WorkItems** — Step 6 in generation pipeline (FinancePending without lines, PostMission with unsettled amounts).
- **Participant cost summary** — per-player breakdown panel showing their linked lines.
- **Multi-currency** — line-level currency + OperatingCurrency conversion.
- **Budget ceiling / approval threshold** — configurable guardrail before "Approve & Confirm".
- **SharePoint Finance lists** — when IT provision is complete.

---

## What Sprint 13 Should Actually Build

The framing for Sprint 13: **"Can the operator look at a mission and answer 'is this financially sound and are we tracking to plan?'"**

Four phases:

**S13-1 — Foundation: types, service, mock data**
- `types/finance.ts` — all types above
- `Mission` extended: `OperatingCurrency` replaces `IncomeCurrency?`
- `utils/financeUtils.ts` — `computeMissionFinanceSummary(lines: MissionFinanceLine[]): MissionFinanceSummary`
- `services/interfaces/IFinanceService.ts` — `listMissionFinanceLines(missionId)`, `approveMission(missionId)`
- `services/mock/MockFinanceService.ts` — 8–10 seeded lines for TR/2026/006 (mix of income/expense, participant-linked, some with actuals)
- `services/sharepoint/SharePointFinanceService.ts` — graceful stub

**S13-2 — Hook layer**
- `useFinanceService` factory hook (ADR-001 pattern)
- `queryKeys.finance` namespace: `finance.forMission(missionId)`, `finance.summary(missionId)`
- `useMissionFinanceLines(missionId)` — raw lines
- `useMissionFinanceSummary(missionId)` — computed via `computeMissionFinanceSummary`
- `useApproveMission` — mutation: sets Mission.Status → 'Confirmed'; invalidates mission cache

**S13-3 — Situation Room Finance section (read-only)**
- `FinanceSection` component — grouped line list (Income / Expense), summary strip at bottom
- `FinanceSummaryStrip` — "Planned AED 75,000 · Actual AED 60,000 · Variance +AED 3,000"
- Situation Room: `useMissionFinanceSummary` added in mission mode; Finance section rendered between Milestones and gap list
- `MissionContextHeader` extended: finance pill ("Planned net USD 25,000") in metadata strip

**S13-4 — Approve & Confirm action**
- "Approve & Confirm Mission" button in Situation Room, visible when `Mission.Status === 'FinancePending'`
- Calls `useApproveMission` mutation
- Mission transitions to Confirmed; ADR-002 activates; operational gaps begin generating
- SATR/2026/003 (currently FinancePending in mock data) gains a finance plan and can be confirmed

This is the minimum viable Finance facet. The operator can see the plan, understand the financial health, and pull the trigger on mission confirmation — without C3 becoming a finance system.

---

## Open Questions

1. **Who can approve a mission?** In v1: any operator. Later: role-gated (Finance Manager only). The `ConfirmedBy` field on Mission already captures the name — the access control layer is deferred.

2. **What happens to the finance plan if a mission is Canceled?** Lines should be preserved for reporting purposes. No deletion on cancel. `Mission.Status = 'Canceled'` is the terminal state; lines remain readable.

3. **Is `Contingency` always expense?** Yes. Reserve buffers are expense headroom. If contingency is released (not spent), it becomes a positive variance, not an income line.

4. **Should PrizeMoney be an income line if it's not yet won?** Yes. The finance plan is a *planning* document, not a ledger of what happened. Planning for expected prize money is correct — it just won't have an ActualAmount until the result is known. If the team doesn't win, the ActualAmount = 0 and the variance is visible.

5. **Should per diem be derived from `MissionParticipant.PerDiemRate × days` or entered as a line?** Both are valid. The PerDiemRate on MissionParticipant is the rate; the PerDiem line is the planned total. Sprint 13 will seed the line manually. A "compute per diem from roster" button is a later UX convenience.

6. **What is the SharePoint list structure?** `SharePointFinanceService` will need a `FinanceLines` list with the same columns as `MissionFinanceLine`. Deferred until IT provision. Graceful stub in place.
