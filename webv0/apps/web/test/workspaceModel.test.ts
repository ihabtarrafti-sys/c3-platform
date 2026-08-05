import { describe, expect, it } from 'vitest';
import {
  defaultWorkspaceState,
  restoreWorkspaceState,
  workspaceReducer,
  type WorkspaceDefinition,
} from '../src/tablework/workspaceModel';

type ModuleId = 'alpha' | 'beta';
type Preset = 'pair' | 'focus';

const DEFINITION: WorkspaceDefinition<ModuleId, Preset> = {
  ids: ['alpha', 'beta'],
  defaultPreset: 'pair',
  presets: {
    pair: [
      { id: 'alpha', visibility: 'open', rect: { x: 0, y: 0, width: 50, height: 100 }, z: 1 },
      { id: 'beta', visibility: 'open', rect: { x: 50, y: 0, width: 50, height: 100 }, z: 2 },
    ],
    focus: [
      { id: 'alpha', visibility: 'open', rect: { x: 0, y: 0, width: 100, height: 100 }, z: 2 },
      { id: 'beta', visibility: 'minimized', rect: { x: 50, y: 0, width: 50, height: 100 }, z: 1 },
    ],
  },
};

describe('Workspace OS model', () => {
  it('owns generic window lifecycle and geometry without mutating its presets', () => {
    const initial = defaultWorkspaceState(DEFINITION);
    const parked = workspaceReducer(DEFINITION, initial, {
      type: 'set-visibility',
      id: 'beta',
      visibility: 'closed',
    });
    const moved = workspaceReducer(DEFINITION, parked, {
      type: 'set-rect',
      id: 'alpha',
      rect: { x: -10, y: 91, width: 130, height: 4 },
    });
    const reopened = workspaceReducer(DEFINITION, moved, { type: 'open', id: 'beta' });

    expect(parked.layout).toBe('custom');
    expect(moved.windows.find((window) => window.id === 'alpha')?.rect).toEqual({
      x: 0,
      y: 74,
      width: 100,
      height: 26,
    });
    expect(reopened.windows.find((window) => window.id === 'beta')).toMatchObject({
      visibility: 'open',
      z: 3,
    });
    expect(DEFINITION.presets.pair[1]).toMatchObject({ visibility: 'open', z: 2 });
  });

  it('applies presets and route activation while preserving an already open layout', () => {
    const focused = workspaceReducer(DEFINITION, defaultWorkspaceState(DEFINITION), {
      type: 'apply-layout',
      layout: 'focus',
    });
    const raised = workspaceReducer(DEFINITION, focused, { type: 'activate-route', id: 'alpha' });
    const opened = workspaceReducer(DEFINITION, raised, { type: 'activate-route', id: 'beta' });

    expect(raised.layout).toBe('focus');
    expect(raised.windows.find((window) => window.id === 'alpha')?.z).toBe(3);
    expect(opened.layout).toBe('custom');
    expect(opened.windows.find((window) => window.id === 'beta')).toMatchObject({
      visibility: 'open',
      z: 4,
    });
  });

  it('restores only the exact closed module set and fails safely on ambiguity', () => {
    const state = workspaceReducer(DEFINITION, defaultWorkspaceState(DEFINITION), {
      type: 'set-visibility',
      id: 'beta',
      visibility: 'minimized',
    });
    expect(restoreWorkspaceState(JSON.stringify(state), DEFINITION)).toEqual(state);

    const unknown = {
      ...state,
      windows: [...state.windows.slice(0, 1), { ...state.windows[1], id: 'gamma' }],
    };
    const duplicate = { ...state, windows: [state.windows[0], state.windows[0]] };
    expect(restoreWorkspaceState(JSON.stringify(unknown), DEFINITION)).toEqual(defaultWorkspaceState(DEFINITION));
    expect(restoreWorkspaceState(JSON.stringify(duplicate), DEFINITION)).toEqual(defaultWorkspaceState(DEFINITION));
    expect(restoreWorkspaceState('{not json', DEFINITION)).toEqual(defaultWorkspaceState(DEFINITION));
  });

  it('runs an explicit compatibility migration before validating the current shape', () => {
    const legacy = {
      version: 1,
      layout: 'custom',
      windows: [{ id: 'alpha', visibility: 'open', rect: { x: 7, y: 8, width: 60, height: 70 }, z: 1 }],
    };
    const migrated = restoreWorkspaceState(JSON.stringify(legacy), DEFINITION, [
      (value) => {
        if (!value || typeof value !== 'object') return value;
        const candidate = value as typeof legacy;
        if (candidate.windows.length !== 1 || candidate.windows[0]?.id !== 'alpha') return value;
        return {
          ...candidate,
          windows: [
            ...candidate.windows,
            { id: 'beta', visibility: 'closed', rect: { x: 50, y: 0, width: 50, height: 100 }, z: 2 },
          ],
        };
      },
    ]);

    expect(migrated.layout).toBe('custom');
    expect(migrated.windows).toHaveLength(2);
    expect(migrated.windows[0]?.rect).toEqual({ x: 7, y: 8, width: 60, height: 70 });
    expect(migrated.windows[1]).toMatchObject({ id: 'beta', visibility: 'closed' });
  });
});
