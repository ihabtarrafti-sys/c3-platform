import type { MissionFinanceLine } from '@c3/types';
import type { IFinanceService } from '../interfaces/IFinanceService';

/**
 * Mock Finance data — two missions demonstrating the financial planning model.
 *
 * TR/2026/006 — RLCS WC 2026 (Confirmed, OperatingCurrency: USD)
 *   11 lines: 3 income + 8 expense.
 *   Some lines have ActualAmount (registration paid, appearance fee received,
 *   one flight booked). Most lines have planned only — mission is mid-planning.
 *   Demonstrates: partial actuals, one over-budget line (PER-0001 flights),
 *   positive plannedNet, hasActuals = true.
 *
 * SATR/2026/003 — Saudi eLeague S2 (FinancePending, OperatingCurrency: SAR)
 *   7 lines: 2 income + 5 expense.
 *   Draft state: all PlannedAmounts set, no ActualAmounts, IsSettled = false.
 *   Demonstrates the state an operator reviews before clicking "Approve & Confirm".
 *   Positive plannedNet (appears to be a financially sound commitment).
 *
 * Participants referenced:
 *   PER-0001 — RL/PL/026, Player on TR/2026/006 (PerDiemRate: 35 USD)
 *   PER-0002 — RL/CH/004, Coach on TR/2026/006 (PerDiemRate: 25 USD)
 *   PER-0004 — FC/PL/001, Player on SATR/2026/003 (PerDiemRate: 35 SAR)
 */

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

const MOCK_FINANCE_LINES: MissionFinanceLine[] = [

  // =========================================================================
  // TR/2026/006 — RLCS 2026 World Championship & EWC
  // Span: 2026-07-08 → 2026-08-16 (40 days)   OperatingCurrency: USD
  // =========================================================================

  // --- Income lines ---

  {
    LineID:        'fl-006-01',
    MissionID:     'TR/2026/006',
    Direction:     'Income',
    Category:      'PrizeMoney',
    Description:   'RLCS WC 2026 — Prize Pool (Top 8 projected share)',
    // No ActualAmount: result unknown until tournament concludes.
    PlannedAmount: 45_000,
    IsSettled:     false,
    Notes:         'Estimate based on 2025 prize pool split. Actual depends on final placement.',
    CreatedAt:     '2026-06-15T10:00:00Z',
  },
  {
    LineID:        'fl-006-02',
    MissionID:     'TR/2026/006',
    Direction:     'Income',
    Category:      'AppearanceFee',
    Description:   'EWC 2026 — Appearance Fee',
    PlannedAmount: 10_000,
    // Received and confirmed — invoice paid by organiser.
    ActualAmount:  10_000,
    IsSettled:     true,
    CreatedAt:     '2026-06-15T10:00:00Z',
  },
  {
    LineID:        'fl-006-03',
    MissionID:     'TR/2026/006',
    Direction:     'Income',
    Category:      'TravelReimbursement',
    Description:   'Psyonix / EWC — Travel Reimbursement Package',
    PlannedAmount: 14_000,
    // Partial confirmation received — final reconciliation pending.
    ActualAmount:  13_800,
    IsSettled:     false,
    Notes:         'Organiser confirmed USD 13,800. Awaiting wire. USD 200 shortfall vs plan.',
    CreatedAt:     '2026-06-15T10:00:00Z',
  },

  // --- Expense lines ---

  {
    LineID:        'fl-006-04',
    MissionID:     'TR/2026/006',
    Direction:     'Expense',
    Category:      'RegistrationFee',
    Description:   'RLCS WC 2026 — Tournament Registration',
    PlannedAmount: 2_500,
    // Paid on confirmation.
    ActualAmount:  2_500,
    IsSettled:     true,
    CreatedAt:     '2026-06-15T10:00:00Z',
  },
  {
    LineID:        'fl-006-05',
    MissionID:     'TR/2026/006',
    Direction:     'Expense',
    Category:      'Travel',
    Description:   'Flights — PER-0001 (RL/PL/026)',
    ParticipantID: 'PER-0001',
    PlannedAmount: 3_400,
    // Booked — came in slightly over plan.
    ActualAmount:  3_580,
    IsSettled:     false,
    Notes:         'Business class upgrade approved. USD 180 over plan.',
    CreatedAt:     '2026-06-18T09:00:00Z',
  },
  {
    LineID:        'fl-006-06',
    MissionID:     'TR/2026/006',
    Direction:     'Expense',
    Category:      'Travel',
    Description:   'Flights — PER-0002 (RL/CH/004)',
    ParticipantID: 'PER-0002',
    PlannedAmount: 3_400,
    // Not yet booked — awaiting visa confirmation.
    IsSettled:     false,
    Notes:         'Pending visa. Do not book until visa milestone is complete.',
    CreatedAt:     '2026-06-18T09:00:00Z',
  },
  {
    LineID:        'fl-006-07',
    MissionID:     'TR/2026/006',
    Direction:     'Expense',
    Category:      'Accommodation',
    Description:   'Hotel — Paris, 40 nights × 2 rooms',
    PlannedAmount: 9_600,
    IsSettled:     false,
    Notes:         'Organiser hotel block at rate USD 120/room/night. Awaiting confirmation.',
    CreatedAt:     '2026-06-15T10:00:00Z',
  },
  {
    LineID:        'fl-006-08',
    MissionID:     'TR/2026/006',
    Direction:     'Expense',
    Category:      'PerDiem',
    Description:   'Per Diem — PER-0001 (Player, 40d × USD 35)',
    ParticipantID: 'PER-0001',
    PlannedAmount: 1_400,
    IsSettled:     false,
    CreatedAt:     '2026-06-15T10:00:00Z',
  },
  {
    LineID:        'fl-006-09',
    MissionID:     'TR/2026/006',
    Direction:     'Expense',
    Category:      'PerDiem',
    Description:   'Per Diem — PER-0002 (Coach, 40d × USD 25)',
    ParticipantID: 'PER-0002',
    PlannedAmount: 1_000,
    IsSettled:     false,
    CreatedAt:     '2026-06-15T10:00:00Z',
  },
  {
    LineID:        'fl-006-10',
    MissionID:     'TR/2026/006',
    Direction:     'Expense',
    Category:      'Equipment',
    Description:   'Gaming peripherals + team gear',
    PlannedAmount: 4_200,
    IsSettled:     false,
    Notes:         'Includes: monitors × 2, keyboards × 2, mice × 2, headsets × 2, team jerseys.',
    CreatedAt:     '2026-06-15T10:00:00Z',
  },
  {
    LineID:        'fl-006-11',
    MissionID:     'TR/2026/006',
    Direction:     'Expense',
    Category:      'Contingency',
    Description:   'Contingency Reserve',
    PlannedAmount: 5_000,
    IsSettled:     false,
    Notes:         'Unallocated reserve. Not to be spent without Finance approval.',
    CreatedAt:     '2026-06-15T10:00:00Z',
  },

  // TR/2026/006 planned summary (for reference):
  //   Income:   45,000 + 10,000 + 14,000 = 69,000 USD
  //   Expense:   2,500 +  3,400 +  3,400 + 9,600 + 1,400 + 1,000 + 4,200 + 5,000 = 30,500 USD
  //   Net:      69,000 − 30,500 = +38,500 USD
  //   Partial actuals: 10,000 + 13,800 − 2,500 − 3,580 = +17,720 USD (incomplete)

  // =========================================================================
  // SATR/2026/003 — Saudi eLeague 2026 Season 2
  // Span: 2026-09-01 → 2026-09-30 (30 days)   OperatingCurrency: SAR
  // Status: FinancePending — draft plan awaiting Finance approval
  // =========================================================================

  // --- Income lines ---

  {
    LineID:        'fl-003-01',
    MissionID:     'SATR/2026/003',
    Direction:     'Income',
    Category:      'AppearanceFee',
    Description:   'Saudi eLeague S2 — Appearance Fee (invited team)',
    PlannedAmount: 75_000,
    IsSettled:     false,
    CreatedAt:     '2026-06-10T09:00:00Z',
  },
  {
    LineID:        'fl-003-02',
    MissionID:     'SATR/2026/003',
    Direction:     'Income',
    Category:      'PrizeMoney',
    Description:   'Saudi eLeague S2 — Prize Pool (Top 4 estimate)',
    PlannedAmount: 150_000,
    IsSettled:     false,
    Notes:         'Conservative estimate based on previous season. Actual depends on placement.',
    CreatedAt:     '2026-06-10T09:00:00Z',
  },

  // --- Expense lines ---

  {
    LineID:        'fl-003-03',
    MissionID:     'SATR/2026/003',
    Direction:     'Expense',
    Category:      'RegistrationFee',
    Description:   'Saudi eLeague S2 — Season Registration',
    PlannedAmount: 5_000,
    IsSettled:     false,
    CreatedAt:     '2026-06-10T09:00:00Z',
  },
  {
    LineID:        'fl-003-04',
    MissionID:     'SATR/2026/003',
    Direction:     'Expense',
    Category:      'Travel',
    Description:   'Flights — PER-0004 (FC/PL/001)',
    ParticipantID: 'PER-0004',
    PlannedAmount: 2_800,
    IsSettled:     false,
    Notes:         'Dubai → Riyadh return. Do not book until mission is confirmed.',
    CreatedAt:     '2026-06-10T09:00:00Z',
  },
  {
    LineID:        'fl-003-05',
    MissionID:     'SATR/2026/003',
    Direction:     'Expense',
    Category:      'Accommodation',
    Description:   'Hotel — Riyadh, 30 nights',
    PlannedAmount: 12_000,
    IsSettled:     false,
    Notes:         'Organiser hotel block expected. Awaiting eLeague accommodation offer.',
    CreatedAt:     '2026-06-10T09:00:00Z',
  },
  {
    LineID:        'fl-003-06',
    MissionID:     'SATR/2026/003',
    Direction:     'Expense',
    Category:      'PerDiem',
    Description:   'Per Diem — PER-0004 (Player, 30d × SAR 35)',
    ParticipantID: 'PER-0004',
    PlannedAmount: 1_050,
    IsSettled:     false,
    CreatedAt:     '2026-06-10T09:00:00Z',
  },
  {
    LineID:        'fl-003-07',
    MissionID:     'SATR/2026/003',
    Direction:     'Expense',
    Category:      'Contingency',
    Description:   'Contingency Reserve',
    PlannedAmount: 10_000,
    IsSettled:     false,
    Notes:         'KSA-specific reserve for last-minute logistics and local transport.',
    CreatedAt:     '2026-06-10T09:00:00Z',
  },

  // SATR/2026/003 planned summary (for reference):
  //   Income:   75,000 + 150,000 = 225,000 SAR
  //   Expense:   5,000 +   2,800 +  12,000 +  1,050 + 10,000 = 30,850 SAR
  //   Net:      225,000 − 30,850 = +194,150 SAR
  //   No actuals — draft state, mission not yet confirmed.
];

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createMockFinanceService = (): IFinanceService => ({
  async listMissionFinanceLines(missionId: string): Promise<MissionFinanceLine[]> {
    const lines = MOCK_FINANCE_LINES.filter(l => l.MissionID === missionId);

    // Order: Income lines first, then Expense lines; within each direction,
    // preserve declaration order (which reflects planning sequence).
    return [
      ...lines.filter(l => l.Direction === 'Income'),
      ...lines.filter(l => l.Direction === 'Expense'),
    ];
  },
});
