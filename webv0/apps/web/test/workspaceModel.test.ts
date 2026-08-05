import { describe, expect, it } from 'vitest';
import {
  MAX_SAVED_WORKSPACE_LAYOUTS,
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

  it('snaps through halves, thirds, quarters, and full canvas without losing the freeform rect', () => {
    const freeform = workspaceReducer(DEFINITION, defaultWorkspaceState(DEFINITION), {
      type: 'set-rect',
      id: 'alpha',
      rect: { x: 12, y: 14, width: 61, height: 72 },
    });
    const left = workspaceReducer(DEFINITION, freeform, {
      type: 'snap-window',
      id: 'alpha',
      snap: 'left-half',
    });
    const quarter = workspaceReducer(DEFINITION, left, {
      type: 'snap-window',
      id: 'alpha',
      snap: 'bottom-right',
    });
    const third = workspaceReducer(DEFINITION, quarter, {
      type: 'snap-window',
      id: 'alpha',
      snap: 'center-third',
    });
    const full = workspaceReducer(DEFINITION, third, { type: 'snap-window', id: 'alpha', snap: 'full' });
    const restored = workspaceReducer(DEFINITION, full, { type: 'restore-window', id: 'alpha' });

    expect(left.windows[0]).toMatchObject({
      rect: { x: 0, y: 0, width: 50, height: 100 },
      snap: 'left-half',
      restoreRect: { x: 12, y: 14, width: 61, height: 72 },
    });
    expect(quarter.windows[0]?.rect).toEqual({ x: 50, y: 50, width: 50, height: 50 });
    expect(third.windows[0]?.rect).toEqual({ x: 33.3, y: 0, width: 33.4, height: 100 });
    expect(full.windows[0]?.rect).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(restored.windows[0]).toMatchObject({
      rect: { x: 12, y: 14, width: 61, height: 72 },
      snap: null,
      restoreRect: null,
    });
  });

  it('saves bounded named device layouts and restores their complete window arrangement', () => {
    const arranged = workspaceReducer(DEFINITION, defaultWorkspaceState(DEFINITION), {
      type: 'set-visibility',
      id: 'beta',
      visibility: 'minimized',
    });
    const saved = workspaceReducer(DEFINITION, arranged, {
      type: 'save-layout',
      id: 'commander-one',
      name: 'Commander one',
    });
    const changed = workspaceReducer(DEFINITION, saved, { type: 'apply-layout', layout: 'pair' });
    const restored = workspaceReducer(DEFINITION, changed, {
      type: 'apply-saved-layout',
      id: 'commander-one',
    });

    expect(saved.savedLayouts).toHaveLength(1);
    expect(saved.activeSavedLayoutId).toBe('commander-one');
    expect(changed.activeSavedLayoutId).toBeNull();
    expect(changed.savedLayouts).toHaveLength(1);
    expect(restored.layout).toBe('custom');
    expect(restored.activeSavedLayoutId).toBe('commander-one');
    expect(restored.windows.find((window) => window.id === 'beta')?.visibility).toBe('minimized');

    let bounded = restored;
    for (let index = 2; index <= MAX_SAVED_WORKSPACE_LAYOUTS; index += 1) {
      bounded = workspaceReducer(DEFINITION, bounded, {
        type: 'save-layout',
        id: `view-${index}`,
        name: `View ${index}`,
      });
    }
    const refused = workspaceReducer(DEFINITION, bounded, {
      type: 'save-layout',
      id: 'view-overflow',
      name: 'One too many',
    });
    const invalid = workspaceReducer(DEFINITION, bounded, {
      type: 'save-layout',
      id: 'invalid name',
      name: '   ',
    });
    expect(bounded.savedLayouts).toHaveLength(MAX_SAVED_WORKSPACE_LAYOUTS);
    expect(refused).toBe(bounded);
    expect(invalid).toBe(bounded);

    const reset = workspaceReducer(DEFINITION, restored, { type: 'reset' });
    const deleted = workspaceReducer(DEFINITION, restored, {
      type: 'delete-saved-layout',
      id: 'commander-one',
    });
    expect(reset.savedLayouts).toHaveLength(1);
    expect(deleted.savedLayouts).toHaveLength(0);
    expect(deleted.activeSavedLayoutId).toBeNull();
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

  it('projects persisted device state so unknown record identity cannot survive restoration', () => {
    const state = defaultWorkspaceState(DEFINITION);
    const tainted = {
      ...state,
      threadId: 'THR-9999',
      activeSavedLayoutId: 'view-1',
      windows: state.windows.map((window) => ({ ...window, threadId: 'THR-9999' })),
      savedLayouts: [
        {
          id: 'view-1',
          name: 'Tainted view',
          threadId: 'THR-9999',
          windows: state.windows.map((window) => ({ ...window, threadId: 'THR-9999' })),
        },
      ],
    };

    const restored = restoreWorkspaceState(JSON.stringify(tainted), DEFINITION);
    expect(restored.activeSavedLayoutId).toBe('view-1');
    expect(restored.savedLayouts).toHaveLength(1);
    expect(JSON.stringify(restored)).not.toContain('THR-9999');
    expect(Object.keys(restored.windows[0]!).sort()).toEqual(
      ['id', 'rect', 'restoreRect', 'snap', 'visibility', 'z'].sort(),
    );
    expect(Object.keys(restored.savedLayouts[0]!).sort()).toEqual(['id', 'name', 'windows'].sort());
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

  it('upgrades a valid v1 arrangement to v2 without discarding geometry or lifecycle', () => {
    const legacy = {
      version: 1,
      layout: 'custom',
      windows: [
        { id: 'alpha', visibility: 'minimized', rect: { x: 7, y: 8, width: 60, height: 70 }, z: 1 },
        { id: 'beta', visibility: 'closed', rect: { x: 61, y: 8, width: 39, height: 70 }, z: 2 },
      ],
    };
    const restored = restoreWorkspaceState(JSON.stringify(legacy), DEFINITION);

    expect(restored).toMatchObject({
      version: 2,
      layout: 'custom',
      activeSavedLayoutId: null,
      savedLayouts: [],
    });
    expect(restored.windows).toEqual([
      { ...legacy.windows[0], snap: null, restoreRect: null },
      { ...legacy.windows[1], snap: null, restoreRect: null },
    ]);
  });
});
