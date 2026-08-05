export type WorkspaceVisibility = 'open' | 'minimized' | 'closed';

export interface WorkspaceRect {
  /** Percent of the owning workspace canvas. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type WorkspaceSnap =
  | 'full'
  | 'left-half'
  | 'right-half'
  | 'left-third'
  | 'center-third'
  | 'right-third'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

export const WORKSPACE_SNAP_RECTS: Readonly<Record<WorkspaceSnap, WorkspaceRect>> = {
  full: { x: 0, y: 0, width: 100, height: 100 },
  'left-half': { x: 0, y: 0, width: 50, height: 100 },
  'right-half': { x: 50, y: 0, width: 50, height: 100 },
  'left-third': { x: 0, y: 0, width: 33.3, height: 100 },
  'center-third': { x: 33.3, y: 0, width: 33.4, height: 100 },
  'right-third': { x: 66.7, y: 0, width: 33.3, height: 100 },
  'top-left': { x: 0, y: 0, width: 50, height: 50 },
  'top-right': { x: 50, y: 0, width: 50, height: 50 },
  'bottom-left': { x: 0, y: 50, width: 50, height: 50 },
  'bottom-right': { x: 50, y: 50, width: 50, height: 50 },
};

const WORKSPACE_SNAPS = Object.keys(WORKSPACE_SNAP_RECTS) as WorkspaceSnap[];
export const MAX_SAVED_WORKSPACE_LAYOUTS = 6;
const SAVED_LAYOUT_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const SAVED_LAYOUT_NAME_MAX = 48;

export interface WorkspaceWindowState<ModuleId extends string> {
  readonly id: ModuleId;
  readonly visibility: WorkspaceVisibility;
  readonly rect: WorkspaceRect;
  readonly z: number;
  readonly snap: WorkspaceSnap | null;
  readonly restoreRect: WorkspaceRect | null;
}

export type WorkspaceWindowSeed<ModuleId extends string> = Omit<
  WorkspaceWindowState<ModuleId>,
  'snap' | 'restoreRect'
> &
  Partial<Pick<WorkspaceWindowState<ModuleId>, 'snap' | 'restoreRect'>>;

export interface SavedWorkspaceLayout<ModuleId extends string> {
  readonly id: string;
  readonly name: string;
  readonly windows: readonly WorkspaceWindowState<ModuleId>[];
}

export type WorkspaceLayout<Preset extends string> = Preset | 'custom';

export interface WorkspaceState<ModuleId extends string, Preset extends string> {
  readonly version: 2;
  readonly layout: WorkspaceLayout<Preset>;
  readonly activeSavedLayoutId: string | null;
  readonly windows: readonly WorkspaceWindowState<ModuleId>[];
  readonly savedLayouts: readonly SavedWorkspaceLayout<ModuleId>[];
}

export type WorkspaceAction<ModuleId extends string, Preset extends string> =
  | { readonly type: 'set-visibility'; readonly id: ModuleId; readonly visibility: WorkspaceVisibility }
  | { readonly type: 'open'; readonly id: ModuleId }
  | { readonly type: 'set-rect'; readonly id: ModuleId; readonly rect: WorkspaceRect }
  | { readonly type: 'bring-forward'; readonly id: ModuleId }
  | { readonly type: 'activate-route'; readonly id: ModuleId }
  | { readonly type: 'snap-window'; readonly id: ModuleId; readonly snap: WorkspaceSnap }
  | { readonly type: 'restore-window'; readonly id: ModuleId }
  | { readonly type: 'apply-layout'; readonly layout: Preset }
  | { readonly type: 'save-layout'; readonly id: string; readonly name: string }
  | { readonly type: 'apply-saved-layout'; readonly id: string }
  | { readonly type: 'delete-saved-layout'; readonly id: string }
  | { readonly type: 'reset' };

export interface WorkspaceDefinition<ModuleId extends string, Preset extends string> {
  readonly ids: readonly ModuleId[];
  readonly defaultPreset: Preset;
  readonly presets: Readonly<Record<Preset, readonly WorkspaceWindowSeed<ModuleId>[]>>;
  readonly minimumWidth?: number;
  readonly minimumHeight?: number;
}

export type WorkspaceStateMigration = (value: unknown) => unknown;

function cloneWindow<ModuleId extends string>(
  window: WorkspaceWindowState<ModuleId>,
): WorkspaceWindowState<ModuleId> {
  return {
    ...window,
    rect: { ...window.rect },
    restoreRect: window.restoreRect ? { ...window.restoreRect } : null,
  };
}

function normalizeSeed<ModuleId extends string>(
  window: WorkspaceWindowSeed<ModuleId>,
): WorkspaceWindowState<ModuleId> {
  return {
    ...window,
    rect: { ...window.rect },
    snap: window.snap ?? null,
    restoreRect: window.restoreRect ? { ...window.restoreRect } : null,
  };
}

function cloneWindows<ModuleId extends string>(
  windows: readonly WorkspaceWindowState<ModuleId>[],
): WorkspaceWindowState<ModuleId>[] {
  return windows.map(cloneWindow);
}

function presetWindows<ModuleId extends string, Preset extends string>(
  definition: WorkspaceDefinition<ModuleId, Preset>,
  preset: Preset,
): WorkspaceWindowState<ModuleId>[] {
  return definition.presets[preset].map(normalizeSeed);
}

export function defaultWorkspaceState<ModuleId extends string, Preset extends string>(
  definition: WorkspaceDefinition<ModuleId, Preset>,
): WorkspaceState<ModuleId, Preset> {
  return {
    version: 2,
    layout: definition.defaultPreset,
    activeSavedLayoutId: null,
    windows: presetWindows(definition, definition.defaultPreset),
    savedLayouts: [],
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampWorkspaceRect(
  rect: WorkspaceRect,
  minimumWidth = 24,
  minimumHeight = 26,
): WorkspaceRect {
  const width = clamp(Math.round(rect.width * 10) / 10, minimumWidth, 100);
  const height = clamp(Math.round(rect.height * 10) / 10, minimumHeight, 100);
  return {
    x: clamp(Math.round(rect.x * 10) / 10, 0, 100 - width),
    y: clamp(Math.round(rect.y * 10) / 10, 0, 100 - height),
    width,
    height,
  };
}

function updateWindow<ModuleId extends string, Preset extends string>(
  state: WorkspaceState<ModuleId, Preset>,
  id: ModuleId,
  update: (window: WorkspaceWindowState<ModuleId>) => WorkspaceWindowState<ModuleId>,
): WorkspaceState<ModuleId, Preset> {
  return {
    ...state,
    windows: state.windows.map((window) => (window.id === id ? update(window) : window)),
  };
}

function nextZ<ModuleId extends string>(windows: readonly WorkspaceWindowState<ModuleId>[]): number {
  return Math.max(0, ...windows.map((window) => window.z)) + 1;
}

function customized<ModuleId extends string, Preset extends string>(
  state: WorkspaceState<ModuleId, Preset>,
  windows: readonly WorkspaceWindowState<ModuleId>[],
): WorkspaceState<ModuleId, Preset> {
  return { ...state, layout: 'custom', activeSavedLayoutId: null, windows };
}

function savedLayoutName(value: string): string | null {
  const name = value.trim();
  if (name.length === 0 || name.length > SAVED_LAYOUT_NAME_MAX || /[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

export function workspaceReducer<ModuleId extends string, Preset extends string>(
  definition: WorkspaceDefinition<ModuleId, Preset>,
  state: WorkspaceState<ModuleId, Preset>,
  action: WorkspaceAction<ModuleId, Preset>,
): WorkspaceState<ModuleId, Preset> {
  switch (action.type) {
    case 'set-visibility': {
      const next = updateWindow(state, action.id, (window) => ({ ...window, visibility: action.visibility }));
      return customized(state, next.windows);
    }
    case 'open': {
      const next = updateWindow(state, action.id, (window) => ({
        ...window,
        visibility: 'open',
        z: nextZ(state.windows),
      }));
      return customized(state, next.windows);
    }
    case 'set-rect': {
      const next = updateWindow(state, action.id, (window) => ({
        ...window,
        rect: clampWorkspaceRect(action.rect, definition.minimumWidth, definition.minimumHeight),
        snap: null,
        restoreRect: null,
      }));
      return customized(state, next.windows);
    }
    case 'bring-forward':
      return updateWindow(state, action.id, (window) => ({ ...window, z: nextZ(state.windows) }));
    case 'activate-route': {
      const target = state.windows.find((window) => window.id === action.id);
      if (!target) return state;
      const next = updateWindow(state, action.id, (window) => ({
        ...window,
        visibility: 'open',
        z: nextZ(state.windows),
      }));
      return target.visibility === 'open' ? next : customized(state, next.windows);
    }
    case 'snap-window': {
      const target = state.windows.find((window) => window.id === action.id);
      if (!target) return state;
      const restoreRect = target.snap === null ? target.rect : (target.restoreRect ?? target.rect);
      const next = updateWindow(state, action.id, (window) => ({
        ...window,
        visibility: 'open',
        rect: { ...WORKSPACE_SNAP_RECTS[action.snap] },
        z: nextZ(state.windows),
        snap: action.snap,
        restoreRect: { ...restoreRect },
      }));
      return customized(state, next.windows);
    }
    case 'restore-window': {
      const target = state.windows.find((window) => window.id === action.id);
      if (!target?.restoreRect) return state;
      const next = updateWindow(state, action.id, (window) => ({
        ...window,
        visibility: 'open',
        rect: { ...target.restoreRect! },
        z: nextZ(state.windows),
        snap: null,
        restoreRect: null,
      }));
      return customized(state, next.windows);
    }
    case 'apply-layout':
      return {
        ...state,
        version: 2,
        layout: action.layout,
        activeSavedLayoutId: null,
        windows: presetWindows(definition, action.layout),
      };
    case 'save-layout': {
      const name = savedLayoutName(action.name);
      if (!SAVED_LAYOUT_ID.test(action.id) || name === null) return state;
      const existing = state.savedLayouts.findIndex((layout) => layout.id === action.id);
      if (existing === -1 && state.savedLayouts.length >= MAX_SAVED_WORKSPACE_LAYOUTS) return state;
      const saved = { id: action.id, name, windows: cloneWindows(state.windows) };
      const savedLayouts =
        existing === -1
          ? [...state.savedLayouts, saved]
          : state.savedLayouts.map((layout, index) => (index === existing ? saved : layout));
      return { ...state, activeSavedLayoutId: action.id, savedLayouts };
    }
    case 'apply-saved-layout': {
      const saved = state.savedLayouts.find((layout) => layout.id === action.id);
      if (!saved) return state;
      return {
        ...state,
        layout: 'custom',
        activeSavedLayoutId: saved.id,
        windows: cloneWindows(saved.windows),
      };
    }
    case 'delete-saved-layout':
      if (!state.savedLayouts.some((layout) => layout.id === action.id)) return state;
      return {
        ...state,
        activeSavedLayoutId: state.activeSavedLayoutId === action.id ? null : state.activeSavedLayoutId,
        savedLayouts: state.savedLayouts.filter((layout) => layout.id !== action.id),
      };
    case 'reset': {
      const reset = defaultWorkspaceState(definition);
      return { ...reset, savedLayouts: state.savedLayouts };
    }
  }
}

function isFiniteRect(value: unknown): value is WorkspaceRect {
  if (!value || typeof value !== 'object') return false;
  const rect = value as Partial<WorkspaceRect>;
  return [rect.x, rect.y, rect.width, rect.height].every(
    (part) => typeof part === 'number' && Number.isFinite(part),
  );
}

function hasExactWindowIds<ModuleId extends string>(
  windows: readonly WorkspaceWindowState<ModuleId>[],
  ids: readonly ModuleId[],
): boolean {
  return (
    windows.length === ids.length &&
    new Set(windows.map((window) => window.id)).size === ids.length &&
    windows.every((window) => ids.includes(window.id))
  );
}

function isWindow<ModuleId extends string>(
  value: unknown,
  ids: readonly ModuleId[],
): value is WorkspaceWindowState<ModuleId> {
  if (!value || typeof value !== 'object') return false;
  const window = value as Partial<WorkspaceWindowState<ModuleId>>;
  const snap = window.snap;
  const restoreRect = window.restoreRect;
  return (
    ids.includes(window.id as ModuleId) &&
    (window.visibility === 'open' || window.visibility === 'minimized' || window.visibility === 'closed') &&
    isFiniteRect(window.rect) &&
    typeof window.z === 'number' &&
    Number.isFinite(window.z) &&
    (snap === null || (typeof snap === 'string' && WORKSPACE_SNAPS.includes(snap as WorkspaceSnap))) &&
    (restoreRect === null || isFiniteRect(restoreRect)) &&
    ((snap === null && restoreRect === null) || (snap !== null && restoreRect !== null))
  );
}

function isSavedLayout<ModuleId extends string>(
  value: unknown,
  ids: readonly ModuleId[],
): value is SavedWorkspaceLayout<ModuleId> {
  if (!value || typeof value !== 'object') return false;
  const layout = value as Partial<SavedWorkspaceLayout<ModuleId>>;
  return (
    typeof layout.id === 'string' &&
    SAVED_LAYOUT_ID.test(layout.id) &&
    typeof layout.name === 'string' &&
    savedLayoutName(layout.name) === layout.name &&
    Array.isArray(layout.windows) &&
    layout.windows.every((window) => isWindow(window, ids)) &&
    hasExactWindowIds(layout.windows, ids)
  );
}

function upgradeVersionOne(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const candidate = value as { version?: unknown; windows?: unknown };
  if (candidate.version !== 1 || !Array.isArray(candidate.windows)) return value;
  return {
    ...candidate,
    version: 2,
    activeSavedLayoutId: null,
    savedLayouts: [],
    windows: candidate.windows.map((window) =>
      window && typeof window === 'object'
        ? { ...window, snap: null, restoreRect: null }
        : window,
    ),
  };
}

function normalizedWindow<ModuleId extends string>(
  window: WorkspaceWindowState<ModuleId>,
  minimumWidth?: number,
  minimumHeight?: number,
): WorkspaceWindowState<ModuleId> {
  return {
    id: window.id,
    visibility: window.visibility,
    rect: clampWorkspaceRect(window.rect, minimumWidth, minimumHeight),
    z: window.z,
    snap: window.snap,
    restoreRect: window.restoreRect
      ? clampWorkspaceRect(window.restoreRect, minimumWidth, minimumHeight)
      : null,
  };
}

export function restoreWorkspaceState<ModuleId extends string, Preset extends string>(
  raw: string | null,
  definition: WorkspaceDefinition<ModuleId, Preset>,
  migrations: readonly WorkspaceStateMigration[] = [],
): WorkspaceState<ModuleId, Preset> {
  const fallback = () => defaultWorkspaceState(definition);
  if (!raw) return fallback();
  try {
    let candidate: unknown = JSON.parse(raw);
    for (const migrate of migrations) candidate = migrate(candidate);
    candidate = upgradeVersionOne(candidate);
    if (!candidate || typeof candidate !== 'object') return fallback();
    const parsed = candidate as Partial<WorkspaceState<ModuleId, Preset>>;
    if (
      parsed.version !== 2 ||
      !Array.isArray(parsed.windows) ||
      !parsed.windows.every((window) => isWindow(window, definition.ids)) ||
      !hasExactWindowIds(parsed.windows, definition.ids) ||
      !Array.isArray(parsed.savedLayouts) ||
      parsed.savedLayouts.length > MAX_SAVED_WORKSPACE_LAYOUTS ||
      !parsed.savedLayouts.every((layout) => isSavedLayout(layout, definition.ids)) ||
      new Set(parsed.savedLayouts.map((layout) => layout.id)).size !== parsed.savedLayouts.length
    ) {
      return fallback();
    }
    const layouts = [...Object.keys(definition.presets), 'custom'];
    if (typeof parsed.layout !== 'string' || !layouts.includes(parsed.layout)) return fallback();
    if (
      parsed.activeSavedLayoutId !== null &&
      (typeof parsed.activeSavedLayoutId !== 'string' ||
        !parsed.savedLayouts.some((layout) => layout.id === parsed.activeSavedLayoutId))
    ) {
      return fallback();
    }
    const normalize = (window: WorkspaceWindowState<ModuleId>) =>
      normalizedWindow(window, definition.minimumWidth, definition.minimumHeight);
    return {
      version: 2,
      layout: parsed.layout as WorkspaceLayout<Preset>,
      activeSavedLayoutId: parsed.activeSavedLayoutId,
      windows: parsed.windows.map(normalize),
      savedLayouts: parsed.savedLayouts.map((layout) => ({
        id: layout.id,
        name: layout.name,
        windows: layout.windows.map(normalize),
      })),
    };
  } catch {
    return fallback();
  }
}
