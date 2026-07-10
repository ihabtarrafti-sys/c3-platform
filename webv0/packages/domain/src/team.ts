/**
 * team.ts — S7, the Teams domain (Track A, plan of record). GK-Core runs its
 * whole P&L "per TEAM/GAME with ROI%" — LOL/R6/RL/HOK plus the Operations/
 * Content/Creatives departments — and person codes are structured
 * GAME/ROLE/NNN (R6/PL/007). Until now `person.currentTeam` was free text;
 * this makes the structure first-class:
 *
 *   - A TEAM is a game division (fields rosters, competes, owns tournament
 *     money) or a department (staff structure). Its short CODE (R6, HOK,
 *     OPS) is unique per tenant and feeds the structured person codes and
 *     every per-team report.
 *   - MEMBERSHIP is one row per (team, person) with the mission-participant
 *     reactivation pattern: history is flips, never deletes.
 *   - Missions gain an optional teamId — the division that fielded the
 *     event — which is what makes "per-team P&L + ROI%" derivable from the
 *     money that already exists. No second ledger.
 *
 * Posture: DIRECT-BUT-AUDITED (org structure records facts — the entity
 * register's standing). Commitments stay where they live: agreements.
 */

import { z } from 'zod';

export const TEAM_KINDS = ['GameDivision', 'Department'] as const;
export type TeamKind = (typeof TEAM_KINDS)[number];

export interface Team {
  /** Canonical business identity, e.g. "TEAM-0001". */
  readonly teamId: string;
  readonly tenantId: string;
  readonly name: string;
  /** Short unique code (R6, HOK, OPS) — feeds person codes and reports. */
  readonly code: string;
  readonly kind: TeamKind;
  /** GameDivision only: the title it competes in (display, free text). */
  readonly gameTitle: string | null;
  readonly notes: string | null;
  readonly isActive: boolean;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TeamMembership {
  readonly tenantId: string;
  readonly teamId: string;
  readonly personId: string;
  /** The person's display name, joined for register reads. */
  readonly personName: string;
  /** Role ON THIS TEAM (Player, Coach, Manager …) — free text, short. */
  readonly role: string;
  readonly isActive: boolean;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ── inputs ───────────────────────────────────────────────────────────────────

/** Team code: REQUIRED (unlike entities — the code IS the reporting key). */
const teamCodeField = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{2,8}$/, 'Code must be 2–8 letters or digits'));

const trimmedOptional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === undefined || v === null || v === '' ? null : v));

export const teamCreateInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(160),
    code: teamCodeField,
    kind: z.enum(TEAM_KINDS),
    gameTitle: trimmedOptional(120),
    notes: trimmedOptional(2000),
  })
  .strict();
export type TeamCreateInput = z.infer<typeof teamCreateInputSchema>;

export const teamUpdateInputSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    name: z.string().trim().min(1).max(160),
    code: teamCodeField,
    gameTitle: trimmedOptional(120),
    notes: trimmedOptional(2000),
  })
  .strict();
export type TeamUpdateInput = z.infer<typeof teamUpdateInputSchema>;

export const teamMemberInputSchema = z
  .object({
    personId: z.string().regex(/^PER-\d{4,}$/, 'personId must be a canonical PER id'),
    role: z.string().trim().min(1, 'A role on the team is required').max(80),
  })
  .strict();
export type TeamMemberInput = z.infer<typeof teamMemberInputSchema>;

// ── structured person codes (GAME/ROLE/NNN — display + suggestion only) ──────

/** GK-Core role abbreviations; unknown roles take their first two letters. */
const ROLE_ABBREV: Record<string, string> = {
  player: 'PL',
  coach: 'CH',
  manager: 'TM',
  'team manager': 'TM',
  analyst: 'AN',
  substitute: 'SB',
  content: 'CT',
};

export function roleAbbrev(role: string): string {
  const key = role.trim().toLowerCase();
  const mapped = ROLE_ABBREV[key];
  if (mapped) return mapped;
  const letters = key.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (letters.slice(0, 2) || 'XX').padEnd(2, 'X');
}

/**
 * Suggest the next structured personnel code for a team + role
 * ({CODE}/{ROLE}/{NNN}, e.g. R6/PL/007) by scanning codes already taken.
 * A SUGGESTION only: `person.personnelCode` stays free-text truth (no
 * person-update surface exists in V1 — the code is shown to copy).
 */
export function suggestPersonnelCode(teamCode: string, role: string, takenCodes: readonly (string | null)[]): string {
  const prefix = `${teamCode.toUpperCase()}/${roleAbbrev(role)}/`;
  let max = 0;
  for (const code of takenCodes) {
    if (!code || !code.toUpperCase().startsWith(prefix)) continue;
    const n = Number(code.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

// ── per-team finance (the #1 real report: P&L per team with ROI%) ────────────

export interface TeamFinanceMissionRow {
  readonly missionId: string;
  readonly name: string;
  readonly code: string | null;
  readonly financeStage: string;
  readonly isActive: boolean;
  readonly blended: { readonly incomeUsdMinor: number; readonly expenseUsdMinor: number; readonly profitUsdMinor: number } | null;
  readonly missingRates: readonly string[];
}

export interface TeamFinance {
  readonly missions: readonly TeamFinanceMissionRow[];
  /**
   * Blended totals across the team's missions — HONEST-NULL one level up:
   * if ANY mission cannot blend (missing FX rates), the team total is null
   * and the culprits are named. A partial sum would be a lie.
   */
  readonly totals: { readonly incomeUsdMinor: number; readonly expenseUsdMinor: number; readonly profitUsdMinor: number } | null;
  /** Mission ids whose missing rates block the team totals. */
  readonly unblendableMissions: readonly string[];
  /**
   * ROI% in basis points (profit / expense × 10000), integer-rounded
   * half-up toward zero-safe: null when totals are null or expense is 0
   * (no spend = no return ratio; the profit column already tells the story).
   */
  readonly roiBps: number | null;
}

/** Aggregate per-mission blended P&Ls into the team view (pure). */
export function buildTeamFinance(rows: readonly TeamFinanceMissionRow[]): TeamFinance {
  const unblendable = rows.filter((r) => r.blended === null).map((r) => r.missionId);
  if (rows.length === 0) return { missions: rows, totals: null, unblendableMissions: [], roiBps: null };
  if (unblendable.length > 0) return { missions: rows, totals: null, unblendableMissions: unblendable, roiBps: null };

  const totals = rows.reduce(
    (acc, r) => ({
      incomeUsdMinor: acc.incomeUsdMinor + r.blended!.incomeUsdMinor,
      expenseUsdMinor: acc.expenseUsdMinor + r.blended!.expenseUsdMinor,
      profitUsdMinor: acc.profitUsdMinor + r.blended!.profitUsdMinor,
    }),
    { incomeUsdMinor: 0, expenseUsdMinor: 0, profitUsdMinor: 0 },
  );
  const roiBps = totals.expenseUsdMinor > 0 ? Math.round((totals.profitUsdMinor / totals.expenseUsdMinor) * 10000) : null;
  return { missions: rows, totals, unblendableMissions: [], roiBps };
}

/** ROI bps → display ("+150.00%", "−12.50%"). */
export function formatRoiBps(roiBps: number): string {
  const pct = roiBps / 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}
