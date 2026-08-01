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

  it('resolves only an explicit, validated mission into the persistent Finance workspace', () => {
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
    expect(missionWorkspaceTargetOf('/missions/finance', '')).toBeNull();
    expect(missionWorkspaceTargetOf('/missions/finance', '?workspace=../../people')).toBeNull();
  });

  it('rewrites only the Finance launcher while a mission workspace owns navigation', () => {
    expect(workspaceHrefFor('/missions/finance', 'MSN-0042')).toBe('/missions/finance?workspace=MSN-0042');
    expect(workspaceHrefFor('/missions', 'MSN-0042')).toBe('/missions');
    expect(workspaceHrefFor('/invoices', 'MSN-0042')).toBe('/invoices');
    expect(workspaceHrefFor('/missions/finance', null)).toBe('/missions/finance');
  });

  it('adds Finance to the closed union without changing the three-window Commander opening', () => {
    expect(DEFAULT_MISSION_COMMAND.windows.map((window) => [window.id, window.visibility])).toEqual([
      ['mission-field', 'open'],
      ['mission-current', 'open'],
      ['mission-obligations', 'open'],
      ['mission-finance', 'closed'],
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
