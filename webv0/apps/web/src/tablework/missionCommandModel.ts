import type { WitnessState } from './TruthPanel';
import {
  clampWorkspaceRect,
  defaultWorkspaceState,
  restoreWorkspaceState,
  workspaceReducer,
  type WorkspaceAction,
  type WorkspaceDefinition,
  type WorkspaceLayout,
  type WorkspaceRect,
  type WorkspaceState,
  type WorkspaceVisibility,
  type WorkspaceWindowState,
} from './workspaceModel';

export type MissionCommandModuleId = 'mission-field' | 'mission-current' | 'mission-obligations' | 'mission-finance';
export type MissionCommandVisibility = WorkspaceVisibility;
export type MissionCommandPreset = 'commander' | 'review' | 'brief' | 'finance';
export type MissionCommandLayout = WorkspaceLayout<MissionCommandPreset>;
export type MissionCommandRect = WorkspaceRect;
export type MissionCommandWindowState = WorkspaceWindowState<MissionCommandModuleId>;
export type MissionCommandState = WorkspaceState<MissionCommandModuleId, MissionCommandPreset>;

type MissionCommandAction = WorkspaceAction<MissionCommandModuleId, MissionCommandPreset>;

const LEGACY_IDS = ['mission-field', 'mission-current', 'mission-obligations'] as const;
const IDS: readonly MissionCommandModuleId[] = [...LEGACY_IDS, 'mission-finance'];
const LEGACY_LAYOUTS: readonly MissionCommandLayout[] = ['commander', 'review', 'brief', 'custom'];

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

const MISSION_COMMAND_DEFINITION: WorkspaceDefinition<MissionCommandModuleId, MissionCommandPreset> = {
  ids: IDS,
  defaultPreset: 'commander',
  presets: PRESETS,
};

export const DEFAULT_MISSION_COMMAND: MissionCommandState = defaultWorkspaceState(MISSION_COMMAND_DEFINITION);

export function clampMissionCommandRect(rect: MissionCommandRect): MissionCommandRect {
  return clampWorkspaceRect(rect);
}

export function missionCommandReducer(state: MissionCommandState, action: MissionCommandAction): MissionCommandState {
  if (action.type === 'activate-route' && action.id === 'mission-finance') {
    const target = state.windows.find((window) => window.id === action.id);
    // The first journey from the untouched Commander workspace into Finance
    // earns the deliberate 50/50 arrangement. Once the actor has customised
    // the field, route activation only reopens and raises the stored rect.
    if (state.layout === 'commander' && target?.visibility === 'closed') {
      return workspaceReducer(MISSION_COMMAND_DEFINITION, state, { type: 'apply-layout', layout: 'finance' });
    }
  }
  return workspaceReducer(MISSION_COMMAND_DEFINITION, state, action);
}

function migrateLegacyMissionCommand(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const candidate = value as { version?: unknown; layout?: unknown; windows?: unknown };
  if (candidate.version !== 1 || !Array.isArray(candidate.windows)) return value;
  if (!LEGACY_LAYOUTS.includes(candidate.layout as MissionCommandLayout)) return value;
  const ids = candidate.windows.map((window) =>
    window && typeof window === 'object' ? (window as { id?: unknown }).id : null,
  );
  if (
    ids.length !== LEGACY_IDS.length ||
    new Set(ids).size !== LEGACY_IDS.length ||
    !ids.every((id) => LEGACY_IDS.includes(id as (typeof LEGACY_IDS)[number]))
  ) {
    return value;
  }
  const finance = PRESETS.commander.find((window) => window.id === 'mission-finance')!;
  return {
    ...candidate,
    windows: [...candidate.windows, { ...finance, rect: { ...finance.rect } }],
  };
}

export function restoreMissionCommand(raw: string | null): MissionCommandState {
  return restoreWorkspaceState(raw, MISSION_COMMAND_DEFINITION, [migrateLegacyMissionCommand]);
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
