export type WorkspaceVisibility = 'open' | 'minimized' | 'closed';

export interface WorkspaceRect {
  /** Percent of the owning workspace canvas. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WorkspaceWindowState<ModuleId extends string> {
  readonly id: ModuleId;
  readonly visibility: WorkspaceVisibility;
  readonly rect: WorkspaceRect;
  readonly z: number;
}

export type WorkspaceLayout<Preset extends string> = Preset | 'custom';

export interface WorkspaceState<ModuleId extends string, Preset extends string> {
  readonly version: 1;
  readonly layout: WorkspaceLayout<Preset>;
  readonly windows: readonly WorkspaceWindowState<ModuleId>[];
}

export type WorkspaceAction<ModuleId extends string, Preset extends string> =
  | { readonly type: 'set-visibility'; readonly id: ModuleId; readonly visibility: WorkspaceVisibility }
  | { readonly type: 'open'; readonly id: ModuleId }
  | { readonly type: 'set-rect'; readonly id: ModuleId; readonly rect: WorkspaceRect }
  | { readonly type: 'bring-forward'; readonly id: ModuleId }
  | { readonly type: 'activate-route'; readonly id: ModuleId }
  | { readonly type: 'apply-layout'; readonly layout: Preset }
  | { readonly type: 'reset' };

export interface WorkspaceDefinition<ModuleId extends string, Preset extends string> {
  readonly ids: readonly ModuleId[];
  readonly defaultPreset: Preset;
  readonly presets: Readonly<Record<Preset, readonly WorkspaceWindowState<ModuleId>[]>>;
  readonly minimumWidth?: number;
  readonly minimumHeight?: number;
}

export type WorkspaceStateMigration = (value: unknown) => unknown;

function cloneWindows<ModuleId extends string>(
  windows: readonly WorkspaceWindowState<ModuleId>[],
): WorkspaceWindowState<ModuleId>[] {
  return windows.map((window) => ({ ...window, rect: { ...window.rect } }));
}

export function defaultWorkspaceState<ModuleId extends string, Preset extends string>(
  definition: WorkspaceDefinition<ModuleId, Preset>,
): WorkspaceState<ModuleId, Preset> {
  return {
    version: 1,
    layout: definition.defaultPreset,
    windows: cloneWindows(definition.presets[definition.defaultPreset]),
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

export function workspaceReducer<ModuleId extends string, Preset extends string>(
  definition: WorkspaceDefinition<ModuleId, Preset>,
  state: WorkspaceState<ModuleId, Preset>,
  action: WorkspaceAction<ModuleId, Preset>,
): WorkspaceState<ModuleId, Preset> {
  switch (action.type) {
    case 'set-visibility':
      return {
        ...updateWindow(state, action.id, (window) => ({ ...window, visibility: action.visibility })),
        layout: 'custom',
      };
    case 'open':
      return {
        ...updateWindow(state, action.id, (window) => ({
          ...window,
          visibility: 'open',
          z: nextZ(state.windows),
        })),
        layout: 'custom',
      };
    case 'set-rect':
      return {
        ...updateWindow(state, action.id, (window) => ({
          ...window,
          rect: clampWorkspaceRect(
            action.rect,
            definition.minimumWidth,
            definition.minimumHeight,
          ),
        })),
        layout: 'custom',
      };
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
      return target.visibility === 'open' ? next : { ...next, layout: 'custom' };
    }
    case 'apply-layout':
      return {
        version: 1,
        layout: action.layout,
        windows: cloneWindows(definition.presets[action.layout]),
      };
    case 'reset':
      return defaultWorkspaceState(definition);
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
  return (
    ids.includes(window.id as ModuleId) &&
    (window.visibility === 'open' || window.visibility === 'minimized' || window.visibility === 'closed') &&
    isFiniteRect(window.rect) &&
    typeof window.z === 'number' &&
    Number.isFinite(window.z)
  );
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
    if (!candidate || typeof candidate !== 'object') return fallback();
    const parsed = candidate as Partial<WorkspaceState<ModuleId, Preset>>;
    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.windows) ||
      !parsed.windows.every((window) => isWindow(window, definition.ids)) ||
      !hasExactWindowIds(parsed.windows, definition.ids)
    ) {
      return fallback();
    }
    const layouts = [...Object.keys(definition.presets), 'custom'];
    if (typeof parsed.layout !== 'string' || !layouts.includes(parsed.layout)) return fallback();
    return {
      version: 1,
      layout: parsed.layout as WorkspaceLayout<Preset>,
      windows: parsed.windows.map((window) => ({
        ...window,
        rect: clampWorkspaceRect(
          window.rect,
          definition.minimumWidth,
          definition.minimumHeight,
        ),
      })),
    };
  } catch {
    return fallback();
  }
}
