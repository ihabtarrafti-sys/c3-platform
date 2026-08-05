/**
 * Iris workspace shell — the cross-route persistence contract.
 *
 * The shell may remember only fixed window geometry. Queries, truth,
 * permissions, drafts, route records, and principal identity stay owned by
 * their live module trees and die at the principal boundary.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { matchRoutes } from 'react-router-dom';
import {
  DEFAULT_MISSION_COMMAND,
  missionCommandReducer,
  restoreMissionCommand,
} from '../src/tablework/missionCommandModel';
import {
  missionRoutes,
  missionWorkspaceTargetOf,
} from '../src/pages/MissionWorkspaceRoute';
import { workspaceHrefFor } from '../src/tablework/workspaceNavigation';
import { principalDataScopeOf } from '../src/principalDataScope';
import { documentHasOpenDialog, mayRecordWorkspaceRead } from '../src/tablework/workspaceAttention';
import { missionFinanceTruthOf } from '../src/pages/MissionFinancePage';
import { ApiError } from '../src/api';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (relative: string): string => readFileSync(join(srcDir, relative), 'utf8');

describe('Iris cross-route workspace model', () => {
  it('matches Finance before the dynamic mission route and keeps both workspace routes under one parent', () => {
    const finance = matchRoutes([missionRoutes], '/missions/finance');
    const comms = matchRoutes([missionRoutes], '/missions/MSN-0042/comms');

    expect(finance?.map((match) => match.route.id)).toEqual(['missions', 'mission-finance']);
    expect(comms?.map((match) => match.route.id)).toEqual(['missions', 'mission-comms']);
    expect(finance?.at(-1)?.route.id).not.toBe('mission-detail');
  });

  it('keeps the missions register and ordinary mission detail behavior explicit in the real route tree', () => {
    expect(matchRoutes([missionRoutes], '/missions')?.map((match) => match.route.id)).toEqual([
      'missions',
      'missions-index',
    ]);
    expect(matchRoutes([missionRoutes], '/missions/MSN-0042')?.map((match) => match.route.id)).toEqual([
      'missions',
      'mission-detail',
    ]);
  });

  it('resolves only an explicit, validated mission into a known persistent workspace module', () => {
    expect(missionWorkspaceTargetOf('/missions/MSN-0042/comms', '')).toEqual({
      missionId: 'MSN-0042',
      requestedModule: 'mission-current',
    });
    expect(missionWorkspaceTargetOf('/missions/MSN-0042/comms', '?open=finance')).toEqual({
      missionId: 'MSN-0042',
      requestedModule: 'mission-finance',
    });
    expect(missionWorkspaceTargetOf('/missions/finance', '?workspace=MSN-0042')).toEqual({
      missionId: 'MSN-0042',
      requestedModule: 'mission-finance',
    });
    expect(missionWorkspaceTargetOf('/approvals', '?workspace=MSN-0042')).toEqual({
      missionId: 'MSN-0042',
      requestedModule: 'approvals-register',
    });
    expect(missionWorkspaceTargetOf('/calendar/', '?workspace=MSN-0042')).toEqual({
      missionId: 'MSN-0042',
      requestedModule: 'calendar-horizon',
    });
    expect(missionWorkspaceTargetOf('/situation', '?workspace=MSN-0042')).toEqual({
      missionId: 'MSN-0042',
      requestedModule: 'command-constellation',
    });
    expect(missionWorkspaceTargetOf('/comms/', '?workspace=MSN-0042')).toEqual({
      missionId: 'MSN-0042',
      requestedModule: 'command-attention',
    });
    expect(missionWorkspaceTargetOf('/people', '?workspace=MSN-0042')).toEqual({
      missionId: 'MSN-0042',
      requestedModule: 'people-field',
    });
    expect(missionWorkspaceTargetOf('/missions/MSN-0042/comms', '?open=continuity')).toEqual({
      missionId: 'MSN-0042',
      requestedModule: 'mission-continuity',
    });
    expect(missionWorkspaceTargetOf('/missions/MSN-0042/comms', '?open=attention')).toEqual({
      missionId: 'MSN-0042',
      requestedModule: 'command-attention',
    });
    expect(missionWorkspaceTargetOf('/comms/threads/THR-0042', '?workspace=MSN-0042')).toEqual({
      missionId: 'MSN-0042',
      requestedModule: 'conversation-relay',
      conversationThreadId: 'THR-0042',
    });
    expect(missionWorkspaceTargetOf('/comms/threads/THR-0042/', '?workspace=MSN-0042')).toEqual({
      missionId: 'MSN-0042',
      requestedModule: 'conversation-relay',
      conversationThreadId: 'THR-0042',
    });
    expect(missionWorkspaceTargetOf('/approvals', '')).toBeNull();
    expect(missionWorkspaceTargetOf('/people', '')).toBeNull();
    expect(missionWorkspaceTargetOf('/people', '?workspace=MSN-0042&extra=true')).toBeNull();
    expect(missionWorkspaceTargetOf('/calendar', '?workspace=MSN-0042&extra=true')).toBeNull();
    expect(missionWorkspaceTargetOf('/missions/finance', '')).toBeNull();
    expect(missionWorkspaceTargetOf('/missions/finance', '?workspace=../../people')).toBeNull();
    expect(missionWorkspaceTargetOf('/missions/finance', '?workspace=MSN-0042&workspace=MSN-0043')).toBeNull();
    expect(missionWorkspaceTargetOf('/missions/finance', '?workspace=MSN-0042&extra=true')).toBeNull();
    expect(missionWorkspaceTargetOf('/missions/MSN-0042/comms', '?open=finance&extra=true')).toBeNull();
    expect(missionWorkspaceTargetOf('/missions/MSN-0042/comms', '?open=current')).toBeNull();
    expect(missionWorkspaceTargetOf('/missions/MSN-0042/comms', '?open=attention&open=continuity')).toBeNull();
    expect(missionWorkspaceTargetOf('/comms/threads/THR-0042', '')).toBeNull();
    expect(missionWorkspaceTargetOf('/comms/threads/not-a-thread', '?workspace=MSN-0042')).toBeNull();
    expect(missionWorkspaceTargetOf('/comms/threads/THR-42', '?workspace=MSN-0042')).toBeNull();
    expect(missionWorkspaceTargetOf('/comms/threads/thr-0042', '?workspace=MSN-0042')).toBeNull();
    expect(missionWorkspaceTargetOf('/comms/threads/THR-0042', '?workspace=MSN-42')).toBeNull();
    expect(missionWorkspaceTargetOf('/comms/threads/THR-0042', '?workspace=msn-0042')).toBeNull();
    expect(missionWorkspaceTargetOf('/comms/threads/THR-0042', '?workspace=MSN-0042&workspace=MSN-0043')).toBeNull();
    expect(missionWorkspaceTargetOf('/comms/threads/THR-0042', '?workspace=MSN-0042&extra=true')).toBeNull();
    expect(missionWorkspaceTargetOf('/missions/MSN-42/comms', '')).toBeNull();
  });

  it('rewrites only known singleton module launchers while a mission workspace owns navigation', () => {
    expect(workspaceHrefFor('/missions/finance', 'MSN-0042')).toBe('/missions/finance?workspace=MSN-0042');
    expect(workspaceHrefFor('/approvals', 'MSN-0042')).toBe('/approvals?workspace=MSN-0042');
    expect(workspaceHrefFor('/calendar', 'MSN-0042')).toBe('/calendar?workspace=MSN-0042');
    expect(workspaceHrefFor('/situation', 'MSN-0042')).toBe('/situation?workspace=MSN-0042');
    expect(workspaceHrefFor('/comms', 'MSN-0042')).toBe('/comms?workspace=MSN-0042');
    expect(workspaceHrefFor('/people', 'MSN-0042')).toBe('/people?workspace=MSN-0042');
    expect(workspaceHrefFor('/missions', 'MSN-0042')).toBe('/missions');
    expect(workspaceHrefFor('/approvals/APR-0001', 'MSN-0042')).toBe('/approvals/APR-0001');
    expect(workspaceHrefFor('/invoices', 'MSN-0042')).toBe('/invoices');
    expect(workspaceHrefFor('/missions/finance', null)).toBe('/missions/finance');
    expect(workspaceHrefFor('/approvals', '../../people')).toBe('/approvals');
  });

  it('adds seven adjacent modules to the closed union without changing the three-window Commander opening', () => {
    expect(DEFAULT_MISSION_COMMAND.windows.map((window) => [window.id, window.visibility])).toEqual([
      ['mission-field', 'open'],
      ['mission-current', 'open'],
      ['mission-obligations', 'open'],
      ['mission-finance', 'closed'],
      ['approvals-register', 'closed'],
      ['calendar-horizon', 'closed'],
      ['command-constellation', 'closed'],
      ['command-attention', 'closed'],
      ['mission-continuity', 'closed'],
      ['conversation-relay', 'closed'],
      ['people-field', 'closed'],
    ]);
  });

  it('upgrades a validated three-window v1 device layout without discarding its geometry', () => {
    const legacy = {
      version: 1,
      layout: 'custom',
      windows: DEFAULT_MISSION_COMMAND.windows.slice(0, 3).map((window, index) => ({
        ...window,
        visibility: index === 0 ? 'minimized' : window.visibility,
        rect: index === 1 ? { x: 7, y: 8, width: 62, height: 74 } : window.rect,
      })),
    };
    const restored = restoreMissionCommand(JSON.stringify(legacy));

    expect(restored.layout).toBe('custom');
    expect(restored.windows.find((window) => window.id === 'mission-current')?.rect).toEqual({
      x: 7,
      y: 8,
      width: 62,
      height: 74,
    });
    expect(restored.windows.find((window) => window.id === 'mission-finance')?.visibility).toBe('closed');
    expect(restored.windows.find((window) => window.id === 'approvals-register')?.visibility).toBe('closed');
    expect(restored.windows.find((window) => window.id === 'calendar-horizon')?.visibility).toBe('closed');
    expect(restored.windows.find((window) => window.id === 'command-constellation')?.visibility).toBe('closed');
    expect(restored.windows.find((window) => window.id === 'command-attention')?.visibility).toBe('closed');
    expect(restored.windows.find((window) => window.id === 'mission-continuity')?.visibility).toBe('closed');
    expect(restored.windows.find((window) => window.id === 'conversation-relay')?.visibility).toBe('closed');
    expect(restored.windows.find((window) => window.id === 'people-field')?.visibility).toBe('closed');
  });

  it('upgrades the nine-window command-loop milestone without persisting a record identity', () => {
    const prior = {
      version: 2,
      layout: 'command',
      activeSavedLayoutId: null,
      windows: DEFAULT_MISSION_COMMAND.windows.slice(0, 9),
      savedLayouts: [],
    };
    const restored = restoreMissionCommand(JSON.stringify(prior));

    expect(restored.layout).toBe('command');
    expect(restored.windows).toHaveLength(11);
    expect(restored.windows.find((window) => window.id === 'conversation-relay')).toMatchObject({
      id: 'conversation-relay',
      visibility: 'closed',
      rect: { x: 18, y: 8, width: 64, height: 84 },
    });
    expect(restored.windows.find((window) => window.id === 'people-field')).toMatchObject({
      id: 'people-field',
      visibility: 'closed',
      rect: { x: 42, y: 0, width: 58, height: 100 },
    });
    expect(JSON.stringify(restored)).not.toContain('THR-');
    expect(JSON.stringify(restored)).not.toContain('PER-');
  });

  it('upgrades the ten-window relay milestone with geometry but no person identity', () => {
    const prior = {
      version: 2,
      layout: 'custom',
      activeSavedLayoutId: null,
      windows: DEFAULT_MISSION_COMMAND.windows.slice(0, 10),
      savedLayouts: [],
    };
    const restored = restoreMissionCommand(JSON.stringify(prior));

    expect(restored.windows).toHaveLength(11);
    expect(restored.windows.find((window) => window.id === 'people-field')).toMatchObject({
      id: 'people-field',
      visibility: 'closed',
      rect: { x: 42, y: 0, width: 58, height: 100 },
    });
    expect(JSON.stringify(restored)).not.toContain('PER-');
  });

  it('upgrades every saved four-window view without discarding its geometry or name', () => {
    const prior = {
      version: 2,
      layout: 'custom',
      activeSavedLayoutId: 'view-1',
      windows: DEFAULT_MISSION_COMMAND.windows.slice(0, 4),
      savedLayouts: [
        {
          id: 'view-1',
          name: 'My command',
          windows: DEFAULT_MISSION_COMMAND.windows.slice(0, 4).map((window) =>
            window.id === 'mission-current'
              ? { ...window, rect: { x: 4, y: 5, width: 61, height: 72 } }
              : window,
          ),
        },
      ],
    };
    const restored = restoreMissionCommand(JSON.stringify(prior));

    expect(restored.activeSavedLayoutId).toBe('view-1');
    expect(restored.savedLayouts[0]?.name).toBe('My command');
    expect(restored.savedLayouts[0]?.windows.find((window) => window.id === 'mission-current')?.rect).toEqual({
      x: 4,
      y: 5,
      width: 61,
      height: 72,
    });
    expect(restored.savedLayouts[0]?.windows.map((window) => window.id)).toEqual(
      DEFAULT_MISSION_COMMAND.windows.map((window) => window.id),
    );
  });

  it('opens the first Finance request 50/50 beside Mission Current and preserves it on return', () => {
    const finance = missionCommandReducer(DEFAULT_MISSION_COMMAND, {
      type: 'activate-route',
      id: 'mission-finance',
    });
    expect(finance.layout).toBe('finance');
    expect(finance.windows.find((window) => window.id === 'mission-current')).toMatchObject({
      visibility: 'open',
      rect: { x: 0, y: 0, width: 49, height: 100 },
    });
    expect(finance.windows.find((window) => window.id === 'mission-finance')).toMatchObject({
      visibility: 'open',
      rect: { x: 51, y: 0, width: 49, height: 100 },
    });

    const current = missionCommandReducer(finance, { type: 'activate-route', id: 'mission-current' });
    expect(current.windows.find((window) => window.id === 'mission-finance')?.visibility).toBe('open');
  });

  it('reopens a deliberately placed Finance window without resetting the custom workspace', () => {
    const placed = missionCommandReducer(
      missionCommandReducer(DEFAULT_MISSION_COMMAND, {
        type: 'set-rect',
        id: 'mission-finance',
        rect: { x: 58, y: 12, width: 38, height: 76 },
      }),
      { type: 'set-visibility', id: 'mission-finance', visibility: 'closed' },
    );
    const reopened = missionCommandReducer(placed, { type: 'activate-route', id: 'mission-finance' });

    expect(reopened.layout).toBe('custom');
    expect(reopened.windows.find((window) => window.id === 'mission-finance')).toMatchObject({
      visibility: 'open',
      rect: { x: 58, y: 12, width: 38, height: 76 },
    });
  });

  it('opens the transient conversation slot without changing its stored geometry or applying a preset', () => {
    const placed = missionCommandReducer(DEFAULT_MISSION_COMMAND, {
      type: 'set-rect',
      id: 'conversation-relay',
      rect: { x: 9, y: 7, width: 73, height: 81 },
    });
    const opened = missionCommandReducer(placed, { type: 'activate-route', id: 'conversation-relay' });

    expect(opened.layout).toBe('custom');
    expect(opened.windows.find((window) => window.id === 'conversation-relay')).toMatchObject({
      visibility: 'open',
      rect: { x: 9, y: 7, width: 73, height: 81 },
    });
  });

  it('earns deliberate Decisions and Planning compositions only on first open', () => {
    const decisions = missionCommandReducer(DEFAULT_MISSION_COMMAND, {
      type: 'activate-route',
      id: 'approvals-register',
    });
    expect(decisions.layout).toBe('decisions');
    expect(decisions.windows.find((window) => window.id === 'mission-current')).toMatchObject({
      visibility: 'open',
      rect: { x: 0, y: 0, width: 49, height: 100 },
    });
    expect(decisions.windows.find((window) => window.id === 'approvals-register')).toMatchObject({
      visibility: 'open',
      rect: { x: 51, y: 0, width: 49, height: 100 },
    });

    const planning = missionCommandReducer(DEFAULT_MISSION_COMMAND, {
      type: 'activate-route',
      id: 'calendar-horizon',
    });
    expect(planning.layout).toBe('planning');
    expect(planning.windows.find((window) => window.id === 'mission-field')).toMatchObject({
      visibility: 'open',
      rect: { x: 0, y: 0, width: 34, height: 100 },
    });
    expect(planning.windows.find((window) => window.id === 'calendar-horizon')).toMatchObject({
      visibility: 'open',
      rect: { x: 35, y: 0, width: 65, height: 100 },
    });
  });

  it('earns deliberate Coordinate, Continuity, and Command compositions only on first open', () => {
    const coordinate = missionCommandReducer(DEFAULT_MISSION_COMMAND, {
      type: 'activate-route',
      id: 'command-attention',
    });
    expect(coordinate.layout).toBe('coordinate');
    expect(coordinate.windows.find((window) => window.id === 'mission-current')).toMatchObject({
      visibility: 'open',
      rect: { x: 0, y: 0, width: 60, height: 100 },
    });
    expect(coordinate.windows.find((window) => window.id === 'command-attention')).toMatchObject({
      visibility: 'open',
      rect: { x: 61, y: 0, width: 39, height: 100 },
    });

    const continuity = missionCommandReducer(DEFAULT_MISSION_COMMAND, {
      type: 'activate-route',
      id: 'mission-continuity',
    });
    expect(continuity.layout).toBe('continuity');
    expect(continuity.windows.find((window) => window.id === 'mission-current')).toMatchObject({
      visibility: 'open',
      rect: { x: 0, y: 0, width: 54, height: 100 },
    });
    expect(continuity.windows.find((window) => window.id === 'mission-continuity')).toMatchObject({
      visibility: 'open',
      rect: { x: 55, y: 0, width: 45, height: 100 },
    });

    const command = missionCommandReducer(DEFAULT_MISSION_COMMAND, {
      type: 'activate-route',
      id: 'command-constellation',
    });
    expect(command.layout).toBe('command');
    expect(command.windows.find((window) => window.id === 'command-constellation')).toMatchObject({
      visibility: 'open',
      rect: { x: 0, y: 0, width: 49, height: 100 },
    });
    expect(command.windows.find((window) => window.id === 'command-attention')).toMatchObject({
      visibility: 'open',
      rect: { x: 51, y: 0, width: 49, height: 100 },
    });
  });

  it('earns a personnel composition only on the first Living Field open', () => {
    const people = missionCommandReducer(DEFAULT_MISSION_COMMAND, {
      type: 'activate-route',
      id: 'people-field',
    });

    expect(people.layout).toBe('people');
    expect(people.windows.find((window) => window.id === 'mission-current')).toMatchObject({
      visibility: 'open',
      rect: { x: 0, y: 0, width: 44, height: 100 },
    });
    expect(people.windows.find((window) => window.id === 'people-field')).toMatchObject({
      visibility: 'open',
      rect: { x: 45, y: 0, width: 55, height: 100 },
    });
  });
});

describe('Iris persistent data boundaries', () => {
  const principal = {
    identity: 'iris@example.test',
    displayName: 'Iris',
    role: 'operations' as const,
    tenantSlug: 'alpha',
    userId: '11111111-1111-4111-8111-111111111111',
    capabilities: { canViewFinancials: true, canManageMissions: true },
  };

  it('changes the in-memory data scope for actor, tenant, role, or capability changes', () => {
    const base = principalDataScopeOf('authenticated', principal);
    expect(principalDataScopeOf('authenticated', { ...principal, userId: '22222222-2222-4222-8222-222222222222' })).not.toBe(base);
    expect(principalDataScopeOf('authenticated', { ...principal, tenantSlug: 'beta' })).not.toBe(base);
    expect(principalDataScopeOf('authenticated', { ...principal, role: 'visitor' })).not.toBe(base);
    expect(principalDataScopeOf('authenticated', { ...principal, capabilities: { ...principal.capabilities, canViewFinancials: false } })).not.toBe(base);
    expect(principalDataScopeOf('anonymous', null)).not.toBe(base);
  });

  it('allows a receipt only for the frontmost Mission Current in an attentive document', () => {
    expect(mayRecordWorkspaceRead('mission-current', 'visible', true, false)).toBe(true);
    expect(mayRecordWorkspaceRead('mission-finance', 'visible', true, false)).toBe(false);
    expect(mayRecordWorkspaceRead('mission-current', 'hidden', true, false)).toBe(false);
    expect(mayRecordWorkspaceRead('mission-current', 'visible', false, false)).toBe(false);
    expect(mayRecordWorkspaceRead('mission-current', 'visible', true, true)).toBe(false);
    expect(mayRecordWorkspaceRead(null, 'visible', true, false)).toBe(false);
  });

  it('rechecks shell-modal occlusion before observing and before committing a read receipt', () => {
    expect(documentHasOpenDialog({ querySelector: () => ({}) as Element })).toBe(true);
    expect(documentHasOpenDialog({ querySelector: () => null })).toBe(false);

    const page = read('pages/MissionCommsPage.tsx');
    const thread = read('tablework/Thread.tsx');
    expect(page.match(/documentHasOpenDialog\(\)/g)).toHaveLength(2);
    expect(thread).toContain('!documentHasOpenDialog()');
  });

  it('never promotes cached Finance money while re-witnessing or after an authoritative refusal', () => {
    const cached = { missions: [] };
    const base = {
      canView: true,
      data: cached,
      error: null,
      isLoading: false,
      isFetching: true,
      dataUpdatedAt: Date.parse('2026-08-01T12:00:00.000Z'),
    };

    expect(missionFinanceTruthOf(base).kind).toBe('stale');
    expect(
      missionFinanceTruthOf({
        ...base,
        isFetching: false,
        error: new ApiError(403, 'FINANCIALS_DENIED', 'No financial standing.'),
      }),
    ).toEqual({ kind: 'denied', reasonClass: 'FINANCIALS_DENIED' });
    expect(
      missionFinanceTruthOf({
        ...base,
        isFetching: false,
        error: new ApiError(500, 'SERVICE_FAILURE', 'Temporarily unavailable.'),
      }).kind,
    ).toBe('stale');
  });

  it('keeps principal identity out of persistence and keeps Finance truth independent from Comms live health', () => {
    const main = read('main.tsx');
    const workspace = read('tablework/MissionCommandWorkspace.tsx');
    const finance = read('pages/MissionFinancePage.tsx');
    const page = read('pages/MissionCommsPage.tsx');
    const dataRoot = main.match(/function PrincipalDataRoot\(\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    const sessionRoot = main.match(/function Root\(\) \{[\s\S]*?\n\}/)?.[0] ?? '';

    expect(main).toContain('principalDataScopeOf');
    expect(main).toContain('new QueryClient');
    expect(sessionRoot).toContain('<SessionProvider>');
    expect(sessionRoot).toContain('<PrincipalDataRoot />');
    expect(sessionRoot).not.toContain('<QueryClientProvider');
    expect(dataRoot).toContain('<QueryClientProvider');
    expect(main).not.toContain('localStorage');
    expect(workspace).toContain('localStorage.setItem(storageKey(missionId), JSON.stringify(state))');
    expect(workspace).toContain("module.unmountWhenClosed && windowState.visibility === 'closed'");
    expect(finance).toContain('truthStateOf');
    expect(finance).not.toContain('withModuleChannelTruth');
    expect(finance).toContain('queryEnabled = enabled && canView');
    expect(page).toContain('mayRecordReadRef.current');
    expect(page).toContain('mayRecordWorkspaceRead(');
    expect(page).toContain('unmountWhenClosed: true');
    expect(page).not.toContain('financeMounted');
  });
});
