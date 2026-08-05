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
  type WorkspaceSnap,
  type WorkspaceState,
  type WorkspaceVisibility,
  type WorkspaceWindowSeed,
  type WorkspaceWindowState,
  type SavedWorkspaceLayout,
} from './workspaceModel';

export type MissionCommandModuleId =
  | 'mission-field'
  | 'mission-current'
  | 'mission-obligations'
  | 'mission-finance'
  | 'approvals-register'
  | 'calendar-horizon'
  | 'command-constellation'
  | 'command-attention'
  | 'mission-continuity'
  | 'conversation-relay'
  | 'people-field';
export type MissionCommandVisibility = WorkspaceVisibility;
export type MissionCommandPreset =
  | 'commander'
  | 'review'
  | 'brief'
  | 'finance'
  | 'decisions'
  | 'planning'
  | 'coordinate'
  | 'continuity'
  | 'command'
  | 'people';
export type MissionCommandLayout = WorkspaceLayout<MissionCommandPreset>;
export type MissionCommandRect = WorkspaceRect;
export type MissionCommandSnap = WorkspaceSnap;
export type MissionCommandWindowState = WorkspaceWindowState<MissionCommandModuleId>;
export type MissionCommandWindowSeed = WorkspaceWindowSeed<MissionCommandModuleId>;
export type MissionCommandSavedLayout = SavedWorkspaceLayout<MissionCommandModuleId>;
export type MissionCommandState = WorkspaceState<MissionCommandModuleId, MissionCommandPreset>;

type MissionCommandAction = WorkspaceAction<MissionCommandModuleId, MissionCommandPreset>;

const ORIGINAL_IDS = ['mission-field', 'mission-current', 'mission-obligations'] as const;
const PRIOR_IDS = [...ORIGINAL_IDS, 'mission-finance'] as const;
const WORKSPACE_OS_IDS = [...PRIOR_IDS, 'approvals-register', 'calendar-horizon'] as const;
const COMMAND_LOOP_IDS = [
  ...WORKSPACE_OS_IDS,
  'command-constellation',
  'command-attention',
  'mission-continuity',
] as const;
const RELAY_IDS = [...COMMAND_LOOP_IDS, 'conversation-relay'] as const;
const IDS: readonly MissionCommandModuleId[] = [...RELAY_IDS, 'people-field'];
const CONVERSATION_SEED: MissionCommandWindowSeed = {
  id: 'conversation-relay',
  visibility: 'closed',
  rect: { x: 18, y: 8, width: 64, height: 84 },
  z: 10,
};
const PEOPLE_FIELD_SEED: MissionCommandWindowSeed = {
  id: 'people-field',
  visibility: 'closed',
  rect: { x: 42, y: 0, width: 58, height: 100 },
  z: 11,
};
const PRIOR_LAYOUTS: readonly MissionCommandLayout[] = [
  'commander',
  'review',
  'brief',
  'finance',
  'decisions',
  'planning',
  'coordinate',
  'continuity',
  'command',
  'custom',
];

const PRESETS: Readonly<Record<MissionCommandPreset, readonly MissionCommandWindowSeed[]>> = {
  commander: [
    { id: 'mission-field', visibility: 'open', rect: { x: 0, y: 0, width: 24, height: 100 }, z: 1 },
    { id: 'mission-current', visibility: 'open', rect: { x: 25, y: 0, width: 49, height: 100 }, z: 3 },
    { id: 'mission-obligations', visibility: 'open', rect: { x: 75, y: 0, width: 25, height: 100 }, z: 2 },
    { id: 'mission-finance', visibility: 'closed', rect: { x: 51, y: 0, width: 49, height: 100 }, z: 4 },
    { id: 'approvals-register', visibility: 'closed', rect: { x: 51, y: 0, width: 49, height: 100 }, z: 5 },
    { id: 'calendar-horizon', visibility: 'closed', rect: { x: 35, y: 0, width: 65, height: 100 }, z: 6 },
    { id: 'command-constellation', visibility: 'closed', rect: { x: 0, y: 0, width: 49, height: 100 }, z: 7 },
    { id: 'command-attention', visibility: 'closed', rect: { x: 61, y: 0, width: 39, height: 100 }, z: 8 },
    { id: 'mission-continuity', visibility: 'closed', rect: { x: 55, y: 0, width: 45, height: 100 }, z: 9 },
    CONVERSATION_SEED,
    PEOPLE_FIELD_SEED,
  ],
  review: [
    { id: 'mission-field', visibility: 'open', rect: { x: 0, y: 0, width: 31, height: 43 }, z: 1 },
    { id: 'mission-current', visibility: 'open', rect: { x: 0, y: 44, width: 62, height: 56 }, z: 2 },
    { id: 'mission-obligations', visibility: 'open', rect: { x: 63, y: 0, width: 37, height: 100 }, z: 3 },
    { id: 'mission-finance', visibility: 'closed', rect: { x: 51, y: 0, width: 49, height: 100 }, z: 4 },
    { id: 'approvals-register', visibility: 'closed', rect: { x: 51, y: 0, width: 49, height: 100 }, z: 5 },
    { id: 'calendar-horizon', visibility: 'closed', rect: { x: 35, y: 0, width: 65, height: 100 }, z: 6 },
    { id: 'command-constellation', visibility: 'closed', rect: { x: 0, y: 0, width: 49, height: 100 }, z: 7 },
    { id: 'command-attention', visibility: 'closed', rect: { x: 61, y: 0, width: 39, height: 100 }, z: 8 },
    { id: 'mission-continuity', visibility: 'closed', rect: { x: 55, y: 0, width: 45, height: 100 }, z: 9 },
    CONVERSATION_SEED,
    PEOPLE_FIELD_SEED,
  ],
  brief: [
    { id: 'mission-field', visibility: 'open', rect: { x: 0, y: 0, width: 34, height: 100 }, z: 2 },
    { id: 'mission-current', visibility: 'open', rect: { x: 35, y: 0, width: 65, height: 100 }, z: 3 },
    { id: 'mission-obligations', visibility: 'minimized', rect: { x: 75, y: 0, width: 25, height: 100 }, z: 1 },
    { id: 'mission-finance', visibility: 'closed', rect: { x: 51, y: 0, width: 49, height: 100 }, z: 4 },
    { id: 'approvals-register', visibility: 'closed', rect: { x: 51, y: 0, width: 49, height: 100 }, z: 5 },
    { id: 'calendar-horizon', visibility: 'closed', rect: { x: 35, y: 0, width: 65, height: 100 }, z: 6 },
    { id: 'command-constellation', visibility: 'closed', rect: { x: 0, y: 0, width: 49, height: 100 }, z: 7 },
    { id: 'command-attention', visibility: 'closed', rect: { x: 61, y: 0, width: 39, height: 100 }, z: 8 },
    { id: 'mission-continuity', visibility: 'closed', rect: { x: 55, y: 0, width: 45, height: 100 }, z: 9 },
    CONVERSATION_SEED,
    PEOPLE_FIELD_SEED,
  ],
  finance: [
    { id: 'mission-field', visibility: 'minimized', rect: { x: 0, y: 0, width: 24, height: 100 }, z: 1 },
    { id: 'mission-current', visibility: 'open', rect: { x: 0, y: 0, width: 49, height: 100 }, z: 3 },
    { id: 'mission-obligations', visibility: 'minimized', rect: { x: 75, y: 0, width: 25, height: 100 }, z: 2 },
    { id: 'mission-finance', visibility: 'open', rect: { x: 51, y: 0, width: 49, height: 100 }, z: 4 },
    { id: 'approvals-register', visibility: 'closed', rect: { x: 51, y: 0, width: 49, height: 100 }, z: 5 },
    { id: 'calendar-horizon', visibility: 'closed', rect: { x: 35, y: 0, width: 65, height: 100 }, z: 6 },
    { id: 'command-constellation', visibility: 'closed', rect: { x: 0, y: 0, width: 49, height: 100 }, z: 7 },
    { id: 'command-attention', visibility: 'closed', rect: { x: 61, y: 0, width: 39, height: 100 }, z: 8 },
    { id: 'mission-continuity', visibility: 'closed', rect: { x: 55, y: 0, width: 45, height: 100 }, z: 9 },
    CONVERSATION_SEED,
    PEOPLE_FIELD_SEED,
  ],
  decisions: [
    { id: 'mission-field', visibility: 'minimized', rect: { x: 0, y: 0, width: 24, height: 100 }, z: 1 },
    { id: 'mission-current', visibility: 'open', rect: { x: 0, y: 0, width: 49, height: 100 }, z: 4 },
    { id: 'mission-obligations', visibility: 'minimized', rect: { x: 75, y: 0, width: 25, height: 100 }, z: 2 },
    { id: 'mission-finance', visibility: 'closed', rect: { x: 51, y: 0, width: 49, height: 100 }, z: 3 },
    { id: 'approvals-register', visibility: 'open', rect: { x: 51, y: 0, width: 49, height: 100 }, z: 6 },
    { id: 'calendar-horizon', visibility: 'closed', rect: { x: 35, y: 0, width: 65, height: 100 }, z: 5 },
    { id: 'command-constellation', visibility: 'closed', rect: { x: 0, y: 0, width: 49, height: 100 }, z: 7 },
    { id: 'command-attention', visibility: 'closed', rect: { x: 61, y: 0, width: 39, height: 100 }, z: 8 },
    { id: 'mission-continuity', visibility: 'closed', rect: { x: 55, y: 0, width: 45, height: 100 }, z: 9 },
    CONVERSATION_SEED,
    PEOPLE_FIELD_SEED,
  ],
  planning: [
    { id: 'mission-field', visibility: 'open', rect: { x: 0, y: 0, width: 34, height: 100 }, z: 4 },
    { id: 'mission-current', visibility: 'minimized', rect: { x: 35, y: 0, width: 65, height: 100 }, z: 1 },
    { id: 'mission-obligations', visibility: 'minimized', rect: { x: 75, y: 0, width: 25, height: 100 }, z: 2 },
    { id: 'mission-finance', visibility: 'closed', rect: { x: 51, y: 0, width: 49, height: 100 }, z: 3 },
    { id: 'approvals-register', visibility: 'closed', rect: { x: 51, y: 0, width: 49, height: 100 }, z: 5 },
    { id: 'calendar-horizon', visibility: 'open', rect: { x: 35, y: 0, width: 65, height: 100 }, z: 6 },
    { id: 'command-constellation', visibility: 'closed', rect: { x: 0, y: 0, width: 49, height: 100 }, z: 7 },
    { id: 'command-attention', visibility: 'closed', rect: { x: 61, y: 0, width: 39, height: 100 }, z: 8 },
    { id: 'mission-continuity', visibility: 'closed', rect: { x: 55, y: 0, width: 45, height: 100 }, z: 9 },
    CONVERSATION_SEED,
    PEOPLE_FIELD_SEED,
  ],
  coordinate: [
    { id: 'mission-field', visibility: 'minimized', rect: { x: 0, y: 0, width: 24, height: 100 }, z: 1 },
    { id: 'mission-current', visibility: 'open', rect: { x: 0, y: 0, width: 60, height: 100 }, z: 8 },
    { id: 'mission-obligations', visibility: 'minimized', rect: { x: 75, y: 0, width: 25, height: 100 }, z: 2 },
    { id: 'mission-finance', visibility: 'closed', rect: { x: 51, y: 0, width: 49, height: 100 }, z: 3 },
    { id: 'approvals-register', visibility: 'closed', rect: { x: 51, y: 0, width: 49, height: 100 }, z: 4 },
    { id: 'calendar-horizon', visibility: 'closed', rect: { x: 35, y: 0, width: 65, height: 100 }, z: 5 },
    { id: 'command-constellation', visibility: 'closed', rect: { x: 0, y: 0, width: 49, height: 100 }, z: 6 },
    { id: 'command-attention', visibility: 'open', rect: { x: 61, y: 0, width: 39, height: 100 }, z: 9 },
    { id: 'mission-continuity', visibility: 'closed', rect: { x: 55, y: 0, width: 45, height: 100 }, z: 7 },
    CONVERSATION_SEED,
    PEOPLE_FIELD_SEED,
  ],
  continuity: [
    { id: 'mission-field', visibility: 'minimized', rect: { x: 0, y: 0, width: 24, height: 100 }, z: 1 },
    { id: 'mission-current', visibility: 'open', rect: { x: 0, y: 0, width: 54, height: 100 }, z: 8 },
    { id: 'mission-obligations', visibility: 'minimized', rect: { x: 75, y: 0, width: 25, height: 100 }, z: 2 },
    { id: 'mission-finance', visibility: 'closed', rect: { x: 51, y: 0, width: 49, height: 100 }, z: 3 },
    { id: 'approvals-register', visibility: 'closed', rect: { x: 51, y: 0, width: 49, height: 100 }, z: 4 },
    { id: 'calendar-horizon', visibility: 'closed', rect: { x: 35, y: 0, width: 65, height: 100 }, z: 5 },
    { id: 'command-constellation', visibility: 'closed', rect: { x: 0, y: 0, width: 49, height: 100 }, z: 6 },
    { id: 'command-attention', visibility: 'closed', rect: { x: 61, y: 0, width: 39, height: 100 }, z: 7 },
    { id: 'mission-continuity', visibility: 'open', rect: { x: 55, y: 0, width: 45, height: 100 }, z: 9 },
    CONVERSATION_SEED,
    PEOPLE_FIELD_SEED,
  ],
  command: [
    { id: 'mission-field', visibility: 'minimized', rect: { x: 0, y: 0, width: 24, height: 100 }, z: 1 },
    { id: 'mission-current', visibility: 'minimized', rect: { x: 0, y: 0, width: 54, height: 100 }, z: 2 },
    { id: 'mission-obligations', visibility: 'minimized', rect: { x: 75, y: 0, width: 25, height: 100 }, z: 3 },
    { id: 'mission-finance', visibility: 'closed', rect: { x: 51, y: 0, width: 49, height: 100 }, z: 4 },
    { id: 'approvals-register', visibility: 'closed', rect: { x: 51, y: 0, width: 49, height: 100 }, z: 5 },
    { id: 'calendar-horizon', visibility: 'closed', rect: { x: 35, y: 0, width: 65, height: 100 }, z: 6 },
    { id: 'command-constellation', visibility: 'open', rect: { x: 0, y: 0, width: 49, height: 100 }, z: 8 },
    { id: 'command-attention', visibility: 'open', rect: { x: 51, y: 0, width: 49, height: 100 }, z: 9 },
    { id: 'mission-continuity', visibility: 'closed', rect: { x: 55, y: 0, width: 45, height: 100 }, z: 7 },
    CONVERSATION_SEED,
    PEOPLE_FIELD_SEED,
  ],
  people: [
    { id: 'mission-field', visibility: 'minimized', rect: { x: 0, y: 0, width: 24, height: 100 }, z: 1 },
    { id: 'mission-current', visibility: 'open', rect: { x: 0, y: 0, width: 44, height: 100 }, z: 10 },
    { id: 'mission-obligations', visibility: 'minimized', rect: { x: 75, y: 0, width: 25, height: 100 }, z: 2 },
    { id: 'mission-finance', visibility: 'closed', rect: { x: 51, y: 0, width: 49, height: 100 }, z: 3 },
    { id: 'approvals-register', visibility: 'closed', rect: { x: 51, y: 0, width: 49, height: 100 }, z: 4 },
    { id: 'calendar-horizon', visibility: 'closed', rect: { x: 35, y: 0, width: 65, height: 100 }, z: 5 },
    { id: 'command-constellation', visibility: 'closed', rect: { x: 0, y: 0, width: 49, height: 100 }, z: 6 },
    { id: 'command-attention', visibility: 'closed', rect: { x: 61, y: 0, width: 39, height: 100 }, z: 7 },
    { id: 'mission-continuity', visibility: 'closed', rect: { x: 55, y: 0, width: 45, height: 100 }, z: 8 },
    CONVERSATION_SEED,
    { ...PEOPLE_FIELD_SEED, visibility: 'open', rect: { x: 45, y: 0, width: 55, height: 100 }, z: 11 },
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
  if (action.type === 'activate-route') {
    const firstOpenLayout: Partial<Record<MissionCommandModuleId, MissionCommandPreset>> = {
      'mission-finance': 'finance',
      'approvals-register': 'decisions',
      'calendar-horizon': 'planning',
      'command-constellation': 'command',
      'command-attention': 'coordinate',
      'mission-continuity': 'continuity',
      'people-field': 'people',
    };
    const layout = firstOpenLayout[action.id];
    const target = state.windows.find((window) => window.id === action.id);
    // A first journey from untouched Commander earns the deliberate module
    // composition. Once the actor customises the field, route activation only
    // reopens and raises the exact stored rectangle.
    if (layout && state.layout === 'commander' && target?.visibility === 'closed') {
      return workspaceReducer(MISSION_COMMAND_DEFINITION, state, { type: 'apply-layout', layout });
    }
  }
  return workspaceReducer(MISSION_COMMAND_DEFINITION, state, action);
}

function knownPriorIds(value: unknown): value is readonly unknown[] {
  if (!Array.isArray(value)) return false;
  const ids = value.map((window) =>
    window && typeof window === 'object' ? (window as { id?: unknown }).id : null,
  );
  const accepted = [ORIGINAL_IDS, PRIOR_IDS, WORKSPACE_OS_IDS, COMMAND_LOOP_IDS, RELAY_IDS].find(
    (known) => ids.length === known.length && ids.every((id) => known.includes(id as never)),
  );
  return accepted !== undefined && new Set(ids).size === accepted.length && ids.every((id) => accepted.includes(id as never));
}

function appendNewModules(windows: readonly unknown[]): readonly unknown[] {
  const present = new Set(
    windows.map((window) => (window && typeof window === 'object' ? (window as { id?: unknown }).id : null)),
  );
  const additions = PRESETS.commander
    .filter((window) => !present.has(window.id))
    .map((window) => ({ ...window, rect: { ...window.rect }, snap: null, restoreRect: null }));
  return [...windows, ...additions];
}

function migratePriorMissionCommand(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const candidate = value as { version?: unknown; layout?: unknown; windows?: unknown; savedLayouts?: unknown };
  if ((candidate.version !== 1 && candidate.version !== 2) || !knownPriorIds(candidate.windows)) return value;
  if (!PRIOR_LAYOUTS.includes(candidate.layout as MissionCommandLayout)) return value;
  if (candidate.version === 2) {
    if (!Array.isArray(candidate.savedLayouts)) return value;
    if (!candidate.savedLayouts.every((layout) => layout && typeof layout === 'object' && knownPriorIds((layout as { windows?: unknown }).windows))) {
      return value;
    }
  }
  const savedLayouts = candidate.savedLayouts as readonly { readonly windows: readonly unknown[] }[] | undefined;
  return {
    ...candidate,
    windows: appendNewModules(candidate.windows),
    ...(candidate.version === 2
      ? {
          savedLayouts: savedLayouts!.map((layout) => ({
            ...layout,
            windows: appendNewModules(layout.windows),
          })),
        }
      : {}),
  };
}

export function restoreMissionCommand(raw: string | null): MissionCommandState {
  return restoreWorkspaceState(raw, MISSION_COMMAND_DEFINITION, [migratePriorMissionCommand]);
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
