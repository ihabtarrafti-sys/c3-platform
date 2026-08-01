import type { WitnessState } from './TruthPanel';

export type MissionCommandModuleId = 'mission-field' | 'mission-current' | 'mission-obligations' | 'mission-finance';
export type MissionCommandVisibility = 'open' | 'minimized' | 'closed';
export type MissionCommandPreset = 'commander' | 'review' | 'brief' | 'finance';
export type MissionCommandLayout = MissionCommandPreset | 'custom';

export interface MissionCommandRect {
  /** Percent of the workspace canvas. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface MissionCommandWindowState {
  readonly id: MissionCommandModuleId;
  readonly visibility: MissionCommandVisibility;
  readonly rect: MissionCommandRect;
  readonly z: number;
}

export interface MissionCommandState {
  readonly version: 1;
  readonly layout: MissionCommandLayout;
  readonly windows: readonly MissionCommandWindowState[];
}

type MissionCommandAction =
  | { readonly type: 'set-visibility'; readonly id: MissionCommandModuleId; readonly visibility: MissionCommandVisibility }
  | { readonly type: 'open'; readonly id: MissionCommandModuleId }
  | { readonly type: 'set-rect'; readonly id: MissionCommandModuleId; readonly rect: MissionCommandRect }
  | { readonly type: 'bring-forward'; readonly id: MissionCommandModuleId }
  | { readonly type: 'activate-route'; readonly id: MissionCommandModuleId }
  | { readonly type: 'apply-layout'; readonly layout: MissionCommandPreset }
  | { readonly type: 'reset' };

const LEGACY_IDS = ['mission-field', 'mission-current', 'mission-obligations'] as const;
const IDS: readonly MissionCommandModuleId[] = [...LEGACY_IDS, 'mission-finance'];
const VISIBILITIES: readonly MissionCommandVisibility[] = ['open', 'minimized', 'closed'];
const LEGACY_LAYOUTS: readonly MissionCommandLayout[] = ['commander', 'review', 'brief', 'custom'];
const LAYOUTS: readonly MissionCommandLayout[] = [...LEGACY_LAYOUTS, 'finance'];

const PRESETS: Readonly<Record<MissionCommandPreset, readonly MissionCommandWindowState[]>> = {
  commander: [
    { id: 'mission-field', visibility: 'open', rect: { x: 0, y: 0, width: 24, height: 100 }, z: 1 },
    { id: 'mission-current', visibility: 'open', rect: { x: 25, y: 0, width: 49, height: 100 }, z: 3 },
    { id: 'mission-obligations', visibility: 'open', rect: { x: 75, y: 0, width: 25, height: 100 }, z: 2 },
    { id: 'mission-finance', visibility: 'closed', rect: { x: 51, y: 0, width: 49, height: 100 }, z: 4 },
  ],
  review: [
    { id: 'mission-field', visibility: 'open', rect: { x: 0, y: 0, width: 31, height: 43 }, z: 1 },
    { id: 'mission-current', visibility: 'open', rect: { x: 0, y: 44, width: 62, height: 56 }, z: 2 },
    { id: 'mission-obligations', visibility: 'open', rect: { x: 63, y: 0, width: 37, height: 100 }, z: 3 },
    { id: 'mission-finance', visibility: 'closed', rect: { x: 51, y: 0, width: 49, height: 100 }, z: 4 },
  ],
  brief: [
    { id: 'mission-field', visibility: 'open', rect: { x: 0, y: 0, width: 34, height: 100 }, z: 2 },
    { id: 'mission-current', visibility: 'open', rect: { x: 35, y: 0, width: 65, height: 100 }, z: 3 },
    { id: 'mission-obligations', visibility: 'minimized', rect: { x: 75, y: 0, width: 25, height: 100 }, z: 1 },
    { id: 'mission-finance', visibility: 'closed', rect: { x: 51, y: 0, width: 49, height: 100 }, z: 4 },
  ],
  finance: [
    { id: 'mission-field', visibility: 'minimized', rect: { x: 0, y: 0, width: 24, height: 100 }, z: 1 },
    { id: 'mission-current', visibility: 'open', rect: { x: 0, y: 0, width: 49, height: 100 }, z: 3 },
    { id: 'mission-obligations', visibility: 'minimized', rect: { x: 75, y: 0, width: 25, height: 100 }, z: 2 },
    { id: 'mission-finance', visibility: 'open', rect: { x: 51, y: 0, width: 49, height: 100 }, z: 4 },
  ],
};

function copyWindows(windows: readonly MissionCommandWindowState[]): MissionCommandWindowState[] {
  return windows.map((window) => ({ ...window, rect: { ...window.rect } }));
}

export const DEFAULT_MISSION_COMMAND: MissionCommandState = {
  version: 1,
  layout: 'commander',
  windows: copyWindows(PRESETS.commander),
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampMissionCommandRect(rect: MissionCommandRect): MissionCommandRect {
  const width = clamp(Math.round(rect.width * 10) / 10, 24, 100);
  const height = clamp(Math.round(rect.height * 10) / 10, 26, 100);
  return {
    x: clamp(Math.round(rect.x * 10) / 10, 0, 100 - width),
    y: clamp(Math.round(rect.y * 10) / 10, 0, 100 - height),
    width,
    height,
  };
}

function updateWindow(
  state: MissionCommandState,
  id: MissionCommandModuleId,
  update: (window: MissionCommandWindowState) => MissionCommandWindowState,
): MissionCommandState {
  return {
    ...state,
    windows: state.windows.map((window) => (window.id === id ? update(window) : window)),
  };
}

export function missionCommandReducer(state: MissionCommandState, action: MissionCommandAction): MissionCommandState {
  switch (action.type) {
    case 'set-visibility':
      return {
        ...updateWindow(state, action.id, (window) => ({ ...window, visibility: action.visibility })),
        layout: 'custom',
      };
    case 'open': {
      const nextZ = Math.max(...state.windows.map((window) => window.z)) + 1;
      return {
        ...updateWindow(state, action.id, (window) => ({ ...window, visibility: 'open', z: nextZ })),
        layout: 'custom',
      };
    }
    case 'set-rect':
      return {
        ...updateWindow(state, action.id, (window) => ({
          ...window,
          rect: clampMissionCommandRect(action.rect),
        })),
        layout: 'custom',
      };
    case 'bring-forward': {
      const nextZ = Math.max(...state.windows.map((window) => window.z)) + 1;
      return updateWindow(state, action.id, (window) => ({ ...window, z: nextZ }));
    }
    case 'activate-route': {
      const target = state.windows.find((window) => window.id === action.id);
      if (!target) return state;
      // The first journey from the untouched Commander workspace into Finance
      // earns the deliberate 50/50 arrangement. Once the actor has customised
      // the field, route activation only reopens and raises the stored rect.
      if (action.id === 'mission-finance' && state.layout === 'commander' && target.visibility === 'closed') {
        return { version: 1, layout: 'finance', windows: copyWindows(PRESETS.finance) };
      }
      const nextZ = Math.max(...state.windows.map((window) => window.z)) + 1;
      const next = updateWindow(state, action.id, (window) => ({ ...window, visibility: 'open', z: nextZ }));
      return target.visibility === 'open' ? next : { ...next, layout: 'custom' };
    }
    case 'apply-layout':
      return { version: 1, layout: action.layout, windows: copyWindows(PRESETS[action.layout]) };
    case 'reset':
      return { ...DEFAULT_MISSION_COMMAND, windows: copyWindows(DEFAULT_MISSION_COMMAND.windows) };
  }
}

function isFiniteRect(value: unknown): value is MissionCommandRect {
  if (!value || typeof value !== 'object') return false;
  const rect = value as Partial<MissionCommandRect>;
  return [rect.x, rect.y, rect.width, rect.height].every((part) => typeof part === 'number' && Number.isFinite(part));
}

function isWindow(value: unknown): value is MissionCommandWindowState {
  if (!value || typeof value !== 'object') return false;
  const window = value as Partial<MissionCommandWindowState>;
  return (
    IDS.includes(window.id as MissionCommandModuleId) &&
    VISIBILITIES.includes(window.visibility as MissionCommandVisibility) &&
    isFiniteRect(window.rect) &&
    typeof window.z === 'number' &&
    Number.isFinite(window.z)
  );
}

function hasExactWindowIds(
  windows: readonly MissionCommandWindowState[],
  ids: readonly MissionCommandModuleId[],
): boolean {
  return windows.length === ids.length && new Set(windows.map((window) => window.id)).size === ids.length &&
    windows.every((window) => ids.includes(window.id));
}

function defaultMissionCommand(): MissionCommandState {
  return { ...DEFAULT_MISSION_COMMAND, windows: copyWindows(DEFAULT_MISSION_COMMAND.windows) };
}

export function restoreMissionCommand(raw: string | null): MissionCommandState {
  if (!raw) return defaultMissionCommand();
  try {
    const parsed = JSON.parse(raw) as Partial<MissionCommandState>;
    if (parsed.version !== 1 || !Array.isArray(parsed.windows) || !parsed.windows.every(isWindow)) return defaultMissionCommand();
    const layout = parsed.layout as MissionCommandLayout;
    const current = LAYOUTS.includes(layout) && hasExactWindowIds(parsed.windows, IDS);
    const legacy = LEGACY_LAYOUTS.includes(layout) && hasExactWindowIds(parsed.windows, LEGACY_IDS);
    if (!current && !legacy) return defaultMissionCommand();
    const windows = parsed.windows.map((window) => ({ ...window, rect: clampMissionCommandRect(window.rect) }));
    if (legacy) {
      const finance = PRESETS.commander.find((window) => window.id === 'mission-finance')!;
      windows.push({ ...finance, rect: { ...finance.rect } });
    }
    return {
      version: 1,
      layout,
      windows,
    };
  } catch {
    return defaultMissionCommand();
  }
}

export interface ModuleChannelState {
  readonly healthy: boolean;
  readonly lastConfirmedAt: Date | string | null;
}

/** Governed mutations require a current successful witness. A prior stale
 * view remains readable, but it cannot authorize time-sensitive action. */
export function isActionableWitness(state: WitnessState): boolean {
  return state.kind === 'verified' || state.kind === 'proven-empty';
}

/**
 * The second cause of stale lives at the module boundary: a prior witness can
 * still be old when the live channel is down even though the last fetch itself
 * succeeded. Every persistent module composes that fact here.
 */
export function withModuleChannelTruth(base: WitnessState, channel: ModuleChannelState): WitnessState {
  if (
    channel.healthy ||
    (base.kind !== 'verified' && base.kind !== 'proven-empty')
  ) {
    return base;
  }
  const parsed =
    channel.lastConfirmedAt === null
      ? base.at
      : channel.lastConfirmedAt instanceof Date
      ? channel.lastConfirmedAt
      : channel.lastConfirmedAt
        ? new Date(channel.lastConfirmedAt)
        : base.at;
  return {
    kind: 'stale',
    verifiedAt: Number.isNaN(parsed.getTime()) ? base.at : parsed,
    message: 'The live channel is not confirmed.',
  };
}
