/**
 * team.test.ts — S7: structured code suggestion (GAME/ROLE/NNN), the
 * honest-null team P&L aggregation with ROI%, and the input contracts.
 */
import { describe, expect, it } from 'vitest';
import {
  buildTeamFinance,
  formatRoiBps,
  roleAbbrev,
  suggestPersonnelCode,
  teamCreateInputSchema,
  teamMemberInputSchema,
  teamUpdateInputSchema,
  type TeamFinanceMissionRow,
} from '../src/index';

describe('structured person codes', () => {
  it('maps GK-Core roles and falls back to first letters', () => {
    expect(roleAbbrev('Player')).toBe('PL');
    expect(roleAbbrev('coach')).toBe('CH');
    expect(roleAbbrev('Team Manager')).toBe('TM');
    expect(roleAbbrev('Analyst')).toBe('AN');
    expect(roleAbbrev('Strategist')).toBe('ST');
    expect(roleAbbrev('Q')).toBe('QX'); // padded, never empty
  });

  it('suggests the next NNN inside the team+role series, ignoring other prefixes and junk', () => {
    const taken = ['R6/PL/007', 'R6/PL/002', 'R6/CH/001', 'HK/PL/009', 'r6/pl/003', 'R6/PL/notanumber', null];
    expect(suggestPersonnelCode('R6', 'Player', taken)).toBe('R6/PL/008');
    expect(suggestPersonnelCode('R6', 'Coach', taken)).toBe('R6/CH/002');
    expect(suggestPersonnelCode('FN', 'Team Manager', taken)).toBe('FN/TM/001');
  });
});

describe('per-team finance (honest-null aggregation + ROI%)', () => {
  const row = (missionId: string, blended: TeamFinanceMissionRow['blended'], missing: string[] = []): TeamFinanceMissionRow => ({
    missionId,
    name: missionId,
    code: null,
    financeStage: 'Settled',
    isActive: true,
    blended,
    missingRates: missing,
  });

  it('sums blended P&Ls and derives ROI in bps', () => {
    const fin = buildTeamFinance([
      row('MSN-0001', { incomeUsdMinor: 1_000_000, expenseUsdMinor: 400_000, profitUsdMinor: 600_000 }),
      row('MSN-0002', { incomeUsdMinor: 200_000, expenseUsdMinor: 400_000, profitUsdMinor: -200_000 }),
    ]);
    expect(fin.totals).toEqual({ incomeUsdMinor: 1_200_000, expenseUsdMinor: 800_000, profitUsdMinor: 400_000 });
    expect(fin.roiBps).toBe(5000); // 400k / 800k = +50.00%
    expect(formatRoiBps(fin.roiBps!)).toBe('+50.00%');
    expect(fin.unblendableMissions).toEqual([]);
  });

  it('ANY unblendable mission nulls the team totals and names the culprit — a partial sum would be a lie', () => {
    const fin = buildTeamFinance([
      row('MSN-0001', { incomeUsdMinor: 1_000_000, expenseUsdMinor: 400_000, profitUsdMinor: 600_000 }),
      row('MSN-0002', null, ['SAR']),
    ]);
    expect(fin.totals).toBeNull();
    expect(fin.roiBps).toBeNull();
    expect(fin.unblendableMissions).toEqual(['MSN-0002']);
  });

  it('zero expense yields no ROI ratio (the profit column tells the story); empty team is null', () => {
    const fin = buildTeamFinance([row('MSN-0001', { incomeUsdMinor: 100, expenseUsdMinor: 0, profitUsdMinor: 100 })]);
    expect(fin.totals).not.toBeNull();
    expect(fin.roiBps).toBeNull();
    expect(buildTeamFinance([]).totals).toBeNull();
  });
});

describe('inputs', () => {
  it('create: code required, uppercased, 2–8 alnum; kind constrained', () => {
    const parsed = teamCreateInputSchema.parse({ name: 'Rainbow Six', code: 'r6', kind: 'GameDivision', gameTitle: 'Rainbow Six Siege' });
    expect(parsed.code).toBe('R6');
    expect(teamCreateInputSchema.safeParse({ name: 'X', code: 'toolongcode99', kind: 'GameDivision' }).success).toBe(false);
    expect(teamCreateInputSchema.safeParse({ name: 'X', code: 'R6', kind: 'Squad' }).success).toBe(false);
    expect(teamCreateInputSchema.safeParse({ name: 'X', kind: 'GameDivision' }).success).toBe(false); // code REQUIRED
  });

  it('update carries the version guard; member input demands a canonical person and a role', () => {
    expect(teamUpdateInputSchema.safeParse({ name: 'X', code: 'R6' }).success).toBe(false); // no expectedVersion
    expect(teamMemberInputSchema.safeParse({ personId: 'PER-1', role: 'Player' }).success).toBe(false);
    expect(teamMemberInputSchema.parse({ personId: 'PER-0001', role: ' Player ' }).role).toBe('Player');
  });
});
