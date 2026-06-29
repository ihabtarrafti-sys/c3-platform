/**
 * FinanceSection — Sprint 13 (Mission Finance: Financial Planning Spine)
 *
 * Read-only finance plan for the selected mission in the Situation Room.
 * Rendered between MissionContextHeader and MilestoneSection in mission mode.
 *
 * Layout:
 *   [Section header: "Financial Plan" + planned net]
 *   [Column labels: PLANNED / ACTUAL]
 *   [Income group header + income rows]
 *   [Expense group header + expense rows]
 *   [Summary strip: planned net · actual net · variance · settlement]
 *
 * Row anatomy (per line):
 *   [Category chip]  [Description + participant?]  [Planned]  [Actual or —]  [Settled dot?]
 *
 * Sprint 13 v1 constraints:
 *   - Read-only. No editing, actuals entry, settlement marking, or approval.
 *   - Variance shown only when all lines have actuals (otherwise misleading).
 *   - Returns null when lines array is empty.
 */

import { Text } from '@fluentui/react-components';

import type {
  MissionFinanceLine,
  MissionFinanceSummary,
  FinanceLineCategory,
} from '@c3/types';

// ---------------------------------------------------------------------------
// Category display labels
// ---------------------------------------------------------------------------

const CATEGORY_LABEL: Record<FinanceLineCategory, string> = {
  PrizeMoney:          'Prize',
  AppearanceFee:       'Appearance',
  TravelReimbursement: 'Travel Reimb',
  Sponsorship:         'Sponsorship',
  RevenueShare:        'Revenue',
  RegistrationFee:     'Entry Fee',
  Travel:              'Travel',
  Accommodation:       'Hotel',
  PerDiem:             'Per Diem',
  PlayerFee:           'Player Fee',
  Equipment:           'Equipment',
  Logistics:           'Logistics',
  Contingency:         'Contingency',
};

// ---------------------------------------------------------------------------
// Currency formatting
// ---------------------------------------------------------------------------

const formatCurrency = (amount: number, currency: string): string =>
  new Intl.NumberFormat('en-US', {
    style:              'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);

/**
 * Formats a net figure with an explicit sign: "+$38,500" or "−$2,000".
 * Uses the proper Unicode minus sign (U+2212) rather than a hyphen.
 */
const formatNet = (amount: number, currency: string): string => {
  const abs = formatCurrency(Math.abs(amount), currency);
  return amount >= 0 ? `+${abs}` : `−${abs}`;
};

// ---------------------------------------------------------------------------
// FinanceLineRow
// ---------------------------------------------------------------------------

interface FinanceLineRowProps {
  line:     MissionFinanceLine;
  currency: string;
}

const FinanceLineRow = ({ line, currency }: FinanceLineRowProps) => {
  const actualAmount = line.ActualAmount;
  const hasActual    = actualAmount !== undefined;

  // Per-line variance colour — expense lines only (income actuals rarely differ)
  const isExpense     = line.Direction === 'Expense';
  const isOverBudget  = hasActual && isExpense && (actualAmount as number) > line.PlannedAmount;
  const isUnderBudget = hasActual && isExpense && (actualAmount as number) < line.PlannedAmount;

  const actualColor = !hasActual
    ? 'var(--c3-gray-300)'
    : isOverBudget  ? 'var(--c3-critical)'
    : isUnderBudget ? 'var(--c3-success)'
    : 'var(--c3-gray-700)';

  return (
    <div
      style={{
        display:       'flex',
        alignItems:    'center',
        gap:           'var(--c3-space-3)',
        padding:       'var(--c3-space-2) var(--c3-space-4)',
        borderBottom:  '1px solid var(--c3-gray-100)',
        minHeight:     40,
      }}
    >
      {/* Category chip */}
      <span
        style={{
          display:         'inline-block',
          padding:         '1px 6px',
          borderRadius:    'var(--c3-radius-sm)',
          backgroundColor: 'var(--c3-gray-100)',
          color:           'var(--c3-gray-500)',
          fontSize:        11,
          fontWeight:      500,
          lineHeight:      '18px',
          whiteSpace:      'nowrap',
          flexShrink:      0,
          minWidth:        72,
          textAlign:       'center',
        }}
      >
        {CATEGORY_LABEL[line.Category]}
      </span>

      {/* Description + optional participant link */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text
          size={300}
          style={{
            display:      'block',
            color:        'var(--c3-gray-900)',
            whiteSpace:   'nowrap',
            overflow:     'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {line.Description}
        </Text>
        {line.ParticipantID && (
          <Text
            size={200}
            style={{
              display:   'block',
              color:     'var(--c3-gray-400)',
              marginTop: 1,
            }}
          >
            {line.ParticipantID}
          </Text>
        )}
      </div>

      {/* Planned amount */}
      <Text
        size={200}
        style={{
          color:      'var(--c3-gray-500)',
          whiteSpace: 'nowrap',
          flexShrink: 0,
          minWidth:   80,
          textAlign:  'right',
        }}
      >
        {formatCurrency(line.PlannedAmount, currency)}
      </Text>

      {/* Actual amount — em dash when not yet known */}
      <Text
        size={200}
        style={{
          color:      actualColor,
          fontWeight: hasActual ? 600 : 400,
          whiteSpace: 'nowrap',
          flexShrink: 0,
          minWidth:   80,
          textAlign:  'right',
        }}
      >
        {hasActual ? formatCurrency(actualAmount as number, currency) : '—'}
      </Text>

      {/* Settled indicator — filled green dot when IsSettled */}
      <div
        style={{
          width:          20,
          flexShrink:     0,
          display:        'flex',
          justifyContent: 'center',
          alignItems:     'center',
        }}
      >
        {line.IsSettled && (
          <div
            style={{
              width:        8,
              height:       8,
              borderRadius: '50%',
              background:   'var(--c3-success)',
            }}
          />
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Group header (Income / Expenses)
// ---------------------------------------------------------------------------

interface GroupHeaderProps {
  label:    string;
  total:    number;
  currency: string;
}

const GroupHeader = ({ label, total, currency }: GroupHeaderProps) => (
  <div
    style={{
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'space-between',
      padding:        'var(--c3-space-2) var(--c3-space-4)',
      background:     'var(--c3-gray-50)',
      borderBottom:   '1px solid var(--c3-gray-100)',
    }}
  >
    <Text
      size={200}
      weight="semibold"
      style={{
        color:          'var(--c3-gray-500)',
        textTransform:  'uppercase',
        letterSpacing:  '0.06em',
      }}
    >
      {label}
    </Text>
    <Text size={200} style={{ color: 'var(--c3-gray-400)' }}>
      {formatCurrency(total, currency)} planned
    </Text>
  </div>
);

// ---------------------------------------------------------------------------
// Summary strip
// ---------------------------------------------------------------------------

interface FinanceSummaryStripProps {
  summary:         MissionFinanceSummary;
  currency:        string;
  /** True when every line has an ActualAmount — variance is reliable. */
  allActualsKnown: boolean;
}

const FinanceSummaryStrip = ({
  summary,
  currency,
  allActualsKnown,
}: FinanceSummaryStripProps) => {
  const netPositive     = summary.plannedNet >= 0;
  const netColor        = netPositive ? 'var(--c3-success)' : 'var(--c3-critical)';
  const varianceColor   = summary.variance >= 0 ? 'var(--c3-success)' : 'var(--c3-critical)';

  const Divider = () => (
    <div style={{ width: 1, height: 32, background: 'var(--c3-gray-200)', flexShrink: 0 }} />
  );

  return (
    <div
      style={{
        display:    'flex',
        gap:        'var(--c3-space-5)',
        padding:    'var(--c3-space-3) var(--c3-space-4)',
        background: 'var(--c3-gray-50)',
        borderTop:  '1px solid var(--c3-gray-100)',
        flexWrap:   'wrap',
        alignItems: 'center',
      }}
    >
      {/* Planned net */}
      <div>
        <Text size={200} style={{ display: 'block', color: 'var(--c3-gray-500)' }}>
          Planned net
        </Text>
        <Text size={300} weight="semibold" style={{ color: netColor }}>
          {formatNet(summary.plannedNet, currency)}
        </Text>
      </div>

      <Divider />

      {/* Actual net — labelled "(partial)" when not all actuals are known */}
      <div>
        <Text size={200} style={{ display: 'block', color: 'var(--c3-gray-500)' }}>
          {summary.hasActuals && !allActualsKnown ? 'Actual net (partial)' : 'Actual net'}
        </Text>
        <Text size={300} weight="semibold" style={{ color: 'var(--c3-gray-700)' }}>
          {summary.hasActuals ? formatNet(summary.actualNet, currency) : '—'}
        </Text>
      </div>

      <Divider />

      {/* Variance — only shown when all actuals are known; otherwise misleading */}
      <div>
        <Text size={200} style={{ display: 'block', color: 'var(--c3-gray-500)' }}>
          Variance
        </Text>
        <Text
          size={300}
          weight="semibold"
          style={{ color: allActualsKnown ? varianceColor : 'var(--c3-gray-400)' }}
        >
          {allActualsKnown ? formatNet(summary.variance, currency) : '—'}
        </Text>
      </div>

      <Divider />

      {/* Settlement progress */}
      <div>
        <Text size={200} style={{ display: 'block', color: 'var(--c3-gray-500)' }}>
          Settled
        </Text>
        <Text size={300} weight="semibold" style={{ color: 'var(--c3-gray-700)' }}>
          {summary.settledLineCount} / {summary.totalLineCount}
        </Text>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// FinanceSection
// ---------------------------------------------------------------------------

export interface FinanceSectionProps {
  lines:    MissionFinanceLine[];
  summary:  MissionFinanceSummary;
  currency: string;
}

export const FinanceSection = ({ lines, summary, currency }: FinanceSectionProps) => {
  if (lines.length === 0) return null;

  const incomeLines  = lines.filter(l => l.Direction === 'Income');
  const expenseLines = lines.filter(l => l.Direction === 'Expense');
  const allActualsKnown = lines.every(l => l.ActualAmount !== undefined);

  const netColor =
    summary.plannedNet > 0 ? 'var(--c3-success)'
    : summary.plannedNet < 0 ? 'var(--c3-critical)'
    : 'var(--c3-gray-500)';

  return (
    <div
      style={{
        borderRadius: 'var(--c3-radius-lg)',
        border:       '1px solid var(--c3-gray-200)',
        background:   'var(--c3-white)',
        overflow:     'hidden',
      }}
    >
      {/* Section header */}
      <div
        style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          padding:        'var(--c3-space-3) var(--c3-space-4)',
          borderBottom:   '1px solid var(--c3-gray-100)',
          background:     'var(--c3-gray-50)',
        }}
      >
        <Text weight="semibold" size={300} style={{ color: 'var(--c3-gray-700)' }}>
          Financial Plan
        </Text>
        <Text size={200} style={{ color: netColor, fontWeight: 600 }}>
          Planned net {formatNet(summary.plannedNet, currency)}
        </Text>
      </div>

      {/* Column label row */}
      <div
        style={{
          display:    'flex',
          alignItems: 'center',
          gap:        'var(--c3-space-3)',
          padding:    '2px var(--c3-space-4)',
          borderBottom: '1px solid var(--c3-gray-100)',
          background: 'var(--c3-white)',
        }}
      >
        {/* Spacer for chip column */}
        <span style={{ minWidth: 72, flexShrink: 0 }} />
        {/* Description column */}
        <div style={{ flex: 1 }} />
        <Text
          size={100}
          style={{
            color:      'var(--c3-gray-400)',
            flexShrink: 0,
            minWidth:   80,
            textAlign:  'right',
          }}
        >
          PLANNED
        </Text>
        <Text
          size={100}
          style={{
            color:      'var(--c3-gray-400)',
            flexShrink: 0,
            minWidth:   80,
            textAlign:  'right',
          }}
        >
          ACTUAL
        </Text>
        {/* Spacer for settled dot column */}
        <div style={{ width: 20, flexShrink: 0 }} />
      </div>

      {/* Income group */}
      {incomeLines.length > 0 && (
        <>
          <GroupHeader
            label="Income"
            total={summary.totalPlannedIncome}
            currency={currency}
          />
          {incomeLines.map(line => (
            <FinanceLineRow key={line.LineID} line={line} currency={currency} />
          ))}
        </>
      )}

      {/* Expense group */}
      {expenseLines.length > 0 && (
        <>
          <GroupHeader
            label="Expenses"
            total={summary.totalPlannedExpenses}
            currency={currency}
          />
          {expenseLines.map(line => (
            <FinanceLineRow key={line.LineID} line={line} currency={currency} />
          ))}
        </>
      )}

      {/* Summary strip */}
      <FinanceSummaryStrip
        summary={summary}
        currency={currency}
        allActualsKnown={allActualsKnown}
      />
    </div>
  );
};
