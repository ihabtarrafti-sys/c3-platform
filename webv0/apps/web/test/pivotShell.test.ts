/**
 * pivotShell.test.ts — the pivot's shell laws, pinned at the source (Wave 0).
 *
 * The e2e suite is the behavior oracle, and it navigates the shell by testid:
 * every spec's login helper clicks `logout` and reads `role-display`; specs
 * click `nav-*` items from wherever they stand; the search and bell specs
 * drive `global-search`/`notif-*`. These pins make a refactor that drops a
 * load-bearing testid fail HERE first — and keep the routing table single-
 * sourced (a second routeFor would be a second route table).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLACES, activePlaceFor, visibleSections } from '../src/tablework/places';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (rel: string): string => readFileSync(join(srcDir, rel), 'utf8');

/** The AppShell NavItem testid contract, byte-identical (incl. the spaces). */
const NAV_TESTIDS = [
  'nav-situation',
  'nav-calendar',
  'nav-people',
  'nav-credentials',
  'nav-journeys',
  'nav-kit',
  'nav-apparel',
  'nav-missions',
  'nav-teams',
  'nav-invoices',
  'nav-subscriptions',
  'nav-claims',
  'nav-agreements',
  'nav-entities',
  'nav-approvals',
  'nav-members',
  'nav-guest intake',
  'nav-departures',
  'nav-activity',
  'nav-recycle bin',
  'nav-settings',
];

describe('the pivot shell laws (Wave 0)', () => {
  it('the flat-nav parity law: every AppShell nav testid exists in the place map', () => {
    const ids = new Set<string>();
    for (const place of PLACES) {
      if (place.testId) ids.add(place.testId);
      for (const s of place.sections) ids.add(s.testId);
    }
    for (const t of NAV_TESTIDS) {
      expect(ids.has(t), `the shell must keep '${t}' one-click reachable — the e2e suite navigates by it`).toBe(true);
    }
  });

  it('the load-bearing shell testids survive in the Tablework sources', () => {
    const frame = read('tablework/AppFrame.tsx');
    for (const t of ['logout', 'role-display', 'tenant-indicator', 'notifications', 'mode-toggle', 'effects-toggle']) {
      expect(frame, `AppFrame must carry data-testid="${t}"`).toContain(`data-testid="${t}"`);
    }
    const search = read('tablework/ShellSearch.tsx');
    for (const t of ['global-search', 'search-results', 'search-chips', 'search-chip-all']) {
      expect(search).toContain(`data-testid="${t}"`);
    }
    expect(search).toContain('data-testid={`search-hit-${r.id}`}');
    expect(search).toContain('data-testid={`search-action-${a.route}`}');
    expect(search).toContain('data-testid={`search-chip-${k}`}');
    const bell = read('tablework/ShellBell.tsx');
    for (const t of ['notif-bell', 'notif-badge', 'notif-mark-all', 'notif-item', 'notif-empty']) {
      expect(bell).toContain(`data-testid="${t}"`);
    }
    // The dismiss word is part of the notices contract.
    expect(frame).toContain('Dismiss');
  });

  it('ONE routing table: both shells import routeFor from shellModel, neither defines it', () => {
    const model = read('shellModel.ts');
    expect(model).toContain('export function routeFor');
    for (const consumer of ['components/GlobalSearch.tsx', 'tablework/ShellSearch.tsx']) {
      const src = read(consumer);
      expect(src, `${consumer} must import the shared routing table`).toMatch(/from '..\/shellModel'/);
      expect(src, `${consumer} must not define its own routeFor`).not.toMatch(/function routeFor/);
    }
  });

  it('the place claims resolve routes correctly (longest claim wins; comms is matched)', () => {
    expect(activePlaceFor('/missions/finance')?.label).toBe('Finance');
    expect(activePlaceFor('/missions/MSN-0001')?.label).toBe('Operations');
    expect(activePlaceFor('/missions/MSN-0001/comms')?.label).toBe('Comms');
    expect(activePlaceFor('/situation')?.label).toBe('Home');
    expect(activePlaceFor('/recycle-bin')?.label).toBe('Organization');
    expect(activePlaceFor('/nowhere')).toBeNull();
  });

  it('gating mirrors the AppShell contract (render-gating only)', () => {
    const none = {
      canReadPeople: true,
      canSubmitApproval: false,
      canReviewApproval: false,
      canExecuteApproval: false,
      canReadMembers: false,
      canSubmitMemberChange: false,
      canOperateJourneys: false,
      canManageKit: false,
      canManageApparel: false,
      canManageMissions: false,
      canManageEntities: false,
      canManageIntake: false,
      canManageSubscriptions: false,
      canReadAgreements: false,
      canViewFinancials: false,
      canViewPerDiem: false,
      canSubmitClaim: false,
      canReadClaims: false,
      canDecideClaim: false,
      canManageDelegations: false,
      canViewSituation: false,
      canViewPersonPII: false,
    };
    const org = PLACES.find((p) => p.label === 'Organization')!;
    // Kit/Apparel stay (ungated registers) even when the admin cluster is gated away.
    expect(visibleSections(org, none).map((s) => s.label)).toEqual(['Kit', 'Apparel']);
    const fin = PLACES.find((p) => p.label === 'Finance')!;
    expect(visibleSections(fin, none)).toEqual([]);
  });
});
