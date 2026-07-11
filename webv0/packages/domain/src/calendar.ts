/**
 * calendar.ts — Track B: the ops calendar / timeline.
 *
 * The forward-looking twin of the activity feed (which looks back) and the
 * Situation Room (which looks now): a single chronological horizon of the dated
 * obligations already in the system — credential expiries, agreement ends,
 * mission start/end, delegation ends. PURE aggregation of data other domains
 * own; it fires NO new signal (the Situation Room already reasons about these
 * expiries) — it just lays them on a timeline you can plan against.
 *
 * Overdue-but-still-open items (an expired credential still marked active) are
 * INCLUDED with a negative daysUntil — that is exactly what a planning view
 * must surface — bounded to the last year so ancient rows do not drown it.
 */

export const CALENDAR_KINDS = ['CredentialExpiry', 'AgreementEnd', 'MissionStart', 'MissionEnd', 'DelegationEnd', 'SubscriptionRenewal'] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];

export interface CalendarItem {
  readonly kind: CalendarKind;
  /** The record's id (CRED-/AGR-/MSN-/DLG-…). */
  readonly id: string;
  /** ISO date (YYYY-MM-DD) the item falls on. */
  readonly date: string;
  /** Signed day distance from today: 0 = today, negative = overdue. */
  readonly daysUntil: number;
  readonly title: string;
  readonly subtitle: string | null;
  /** The in-app route this item opens. */
  readonly route: string;
}

/** Slim, per-actor inputs (the use case supplies exactly what the reads hold). */
export interface CalendarInput {
  readonly credentials: ReadonlyArray<{ credentialId: string; personId: string; credentialType: string; expiresOn: string | null; isActive: boolean; personName?: string | null }>;
  readonly agreements: ReadonlyArray<{ agreementId: string; personId: string | null; agreementType: string; endsOn: string; status: string }>;
  readonly missions: ReadonlyArray<{ missionId: string; name: string; startsOn: string; endsOn: string | null; isActive: boolean }>;
  readonly delegations: ReadonlyArray<{ delegationId: string; granteeIdentity: string; endsOn: string; revokedAt: string | null }>;
  readonly subscriptions: ReadonlyArray<{ subscriptionId: string; name: string; vendorName: string; nextRenewalOn: string | null; status: string }>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const OVERDUE_FLOOR_DAYS = -365; // ignore anything more than a year overdue

/** Whole-day signed distance between two plain ISO dates (UTC, DST-safe). */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.round((b - a) / DAY_MS);
}

/**
 * Build the horizon: every open dated obligation whose date is within
 * [today − 365d, today + horizonDays], sorted soonest-first (overdue before
 * upcoming). Horizon is clamped to a sane range by the caller/schema.
 */
export function buildCalendar(input: CalendarInput, todayIso: string, horizonDays: number): CalendarItem[] {
  const items: CalendarItem[] = [];
  const push = (kind: CalendarKind, id: string, date: string, title: string, subtitle: string | null, route: string) => {
    const daysUntil = daysBetween(todayIso, date);
    if (daysUntil > horizonDays || daysUntil < OVERDUE_FLOOR_DAYS) return;
    items.push({ kind, id, date, daysUntil, title, subtitle, route });
  };

  for (const c of input.credentials) {
    if (!c.isActive || !c.expiresOn) continue;
    push('CredentialExpiry', c.credentialId, c.expiresOn, `${c.credentialType} expires`, c.personName ?? c.personId, `/people/${c.personId}`);
  }
  for (const a of input.agreements) {
    if (a.status !== 'Active') continue;
    push('AgreementEnd', a.agreementId, a.endsOn, `${a.agreementType} ends`, a.personId, `/agreements/${a.agreementId}`);
  }
  for (const m of input.missions) {
    if (!m.isActive) continue;
    push('MissionStart', m.missionId, m.startsOn, `${m.name} starts`, null, `/missions/${m.missionId}`);
    if (m.endsOn) push('MissionEnd', m.missionId, m.endsOn, `${m.name} ends`, null, `/missions/${m.missionId}`);
  }
  for (const d of input.delegations) {
    if (d.revokedAt) continue;
    push('DelegationEnd', d.delegationId, d.endsOn, `Approver delegation ends`, d.granteeIdentity, `/approvals`);
  }
  for (const sub of input.subscriptions) {
    if (sub.status !== 'Active' || !sub.nextRenewalOn) continue;
    push('SubscriptionRenewal', sub.subscriptionId, sub.nextRenewalOn, `${sub.name} renews`, sub.vendorName, `/subscriptions`);
  }

  // Soonest first; ties broken by kind then id for a stable order.
  items.sort((x, y) => x.daysUntil - y.daysUntil || x.kind.localeCompare(y.kind) || x.id.localeCompare(y.id));
  return items;
}
