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

  it('W0-2: the forms/governed kit keeps the Fluent contracts byte-compatible', () => {
    const drawer = read('tablework/forms.tsx');
    // The composer sheet: the close testid + BOTH taxonomy chip words verbatim.
    expect(drawer).toContain('data-testid="form-drawer-close"');
    expect(drawer).toContain("'Governed request'");
    expect(drawer).toContain("'Immediate · recorded'");
    // The dirty-guard law rides the API: NO state lives in the drawer at all
    // (field state is the caller's; the deterministic lifecycle needs none) —
    // and the closed sheet UNMOUNTS (Fluent count-0 parity) with close() in
    // the unmount cleanup so the native focus-return happens first.
    const drawerFn = drawer.slice(drawer.indexOf('export function FormDrawer'));
    expect(drawerFn).not.toMatch(/useState/);
    expect(drawerFn).toContain('if (!open) return null;');
    expect(drawerFn).toMatch(/return \(\) => \{\s*if \(dialog\.open\) dialog\.close\(\);/);
    const governed = read('tablework/GovernedAction.tsx');
    // The trigger keeps the caller's testid; the confirm carries -confirm.
    expect(governed).toContain('data-testid={triggerTestId}');
    expect(governed).toContain('data-testid={`${triggerTestId}-confirm`}');
    expect(governed).toContain("'Working…'");
    expect(governed).toContain('Cancel');
    // A rejecting onConfirm keeps the dialog OPEN.
    expect(governed).toMatch(/catch \{/);
  });

  it('W0-3: the collection/state kit keeps the Fluent contracts byte-compatible', () => {
    const collections = read('tablework/collections.tsx');
    // The truthful-states copy + roles verbatim (A.12).
    expect(collections).toContain("label = 'Loading…'");
    expect(collections).toContain('role="status"');
    expect(collections).toContain('role="alert"');
    expect(collections).toContain('Reference: {correlationId}');
    // The B.8 badge variant map survives whole.
    for (const v of ['ready', 'pending', 'blocked', 'neutral', 'info', 'signal']) {
      expect(collections).toContain(`${v}:`);
    }
    // The document-title parity with PageHeader.
    expect(collections).toContain('`C3 — ${title}`');
    // The comparison scroll region stays keyboard-reachable.
    expect(collections).toContain('tabIndex={0}');
  });

  it('the record-family front-load keeps the cross-cutting testid contracts byte-compatible', () => {
    const records = read('tablework/records.tsx');
    // DocumentsSection: the S4 oracle surface, verbatim.
    for (const t of ['documents-panel', 'document-file-input', 'attach-document', 'documents-empty', 'documents-list']) {
      expect(records).toContain(`data-testid="${t}"`);
    }
    expect(records).toContain('data-testid={`document-row-${d.documentId}`}');
    expect(records).toContain('data-testid={`download-document-${d.documentId}`}');
    expect(records).toContain('triggerTestId={`remove-document-${d.documentId}`}');
    expect(records).toContain('No documents attached.');
    // CommentThread: the B4 oracle surface (the mention picker is spec-free
    // and becomes chips — same container testid).
    for (const t of ['comment-thread', 'comments-empty', 'comment-body', 'comment-mentions', 'comment-submit']) {
      expect(records).toContain(`data-testid="${t}"`);
    }
    expect(records).toContain('No comments yet. Start the thread.');
    // The written lane rule rides the source.
    expect(records).toContain('Breadcrumbs do NOT port');
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
