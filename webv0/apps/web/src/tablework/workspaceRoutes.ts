import type { MissionCommandModuleId } from './missionCommandModel';
import {
  MONEY_CONTINUITY_EXTERNAL_ROUTES,
  type MoneyContinuityLens,
} from './moneyContinuityModel';

const MISSION_ID = /^MSN-\d{4,}$/;
const MISSION_COMMS_PATH = /^\/missions\/(MSN-\d{4,})\/comms\/?$/;
const THREAD_ROOM_PATH = /^\/comms\/threads\/(THR-\d{4,})\/?$/;
const PERSON_RECORD_PATH = /^\/people\/(PER-\d{4,})\/?$/;
type PersistentWorkspaceModuleId = Exclude<MissionCommandModuleId, 'conversation-relay' | 'person-record'>;

const COMMS_OPEN_MODULES: Readonly<Record<string, PersistentWorkspaceModuleId>> = {
  finance: 'mission-finance',
  obligations: 'mission-obligations',
  constellation: 'command-constellation',
  attention: 'command-attention',
  continuity: 'mission-continuity',
};

const MISSION_SCOPED_MODULE_ROUTES: ReadonlyArray<{
  readonly pathname: string;
  readonly moduleId: Extract<
    PersistentWorkspaceModuleId,
    | 'approvals-register'
    | 'calendar-horizon'
    | 'command-constellation'
    | 'command-attention'
    | 'people-field'
    | 'seats-standing'
    | 'organization-continuity'
  >;
}> = [
  { pathname: '/approvals', moduleId: 'approvals-register' },
  { pathname: '/calendar', moduleId: 'calendar-horizon' },
  { pathname: '/situation', moduleId: 'command-constellation' },
  { pathname: '/comms', moduleId: 'command-attention' },
  { pathname: '/people', moduleId: 'people-field' },
  { pathname: '/members', moduleId: 'seats-standing' },
  { pathname: '/teams', moduleId: 'organization-continuity' },
  { pathname: '/entities', moduleId: 'organization-continuity' },
];

export type WorkspaceRouteTarget =
  | {
      readonly missionId: string;
      readonly requestedModule: Exclude<MissionCommandModuleId, 'conversation-relay' | 'person-record' | 'mission-finance'>;
      readonly conversationThreadId?: never;
      readonly personId?: never;
      readonly moneyLens?: never;
    }
  | {
      readonly missionId: string;
      readonly requestedModule: 'mission-finance';
      /** Runtime selection for the one persistent money desk. It is route and
       * React state only; the saved window owns geometry, never this lens. */
      readonly moneyLens: MoneyContinuityLens;
      readonly conversationThreadId?: never;
      readonly personId?: never;
    }
  | {
      readonly missionId: string;
      readonly requestedModule: 'conversation-relay';
      /** Runtime identity for the one transient conversation slot. It travels
       * in the route and live React tree, never in persisted window state. */
      readonly conversationThreadId: string;
      readonly personId?: never;
      readonly moneyLens?: never;
    }
  | {
      readonly missionId: string;
      readonly requestedModule: 'person-record';
      readonly conversationThreadId?: never;
      /** Runtime identity for the one transient person slot. The fixed window
       * may persist geometry; this record key never does. */
      readonly personId: string;
      readonly moneyLens?: never;
    };

function canonicalPath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

/**
 * The one fail-closed adapter from browser locations into known workspace
 * instances. Record-detail routes never enter this table: their identity stays
 * page-owned until an instance-safe persistence model exists.
 */
export function workspaceRouteTargetOf(pathname: string, search: string): WorkspaceRouteTarget | null {
  const comms = MISSION_COMMS_PATH.exec(pathname);
  if (comms) {
    const params = new URLSearchParams(search);
    const open = params.getAll('open');
    if (params.size > 0 && (params.size !== 1 || open.length !== 1 || !COMMS_OPEN_MODULES[open[0]!])) return null;
    const requestedModule = open.length === 1 ? COMMS_OPEN_MODULES[open[0]!]! : 'mission-current';
    return requestedModule === 'mission-finance'
      ? { missionId: comms[1]!, requestedModule, moneyLens: 'mission' }
      : { missionId: comms[1]!, requestedModule };
  }

  const threadRoom = THREAD_ROOM_PATH.exec(pathname);
  if (threadRoom) {
    const params = new URLSearchParams(search);
    const workspace = params.getAll('workspace');
    if (params.size !== 1 || workspace.length !== 1 || !MISSION_ID.test(workspace[0]!)) return null;
    return {
      missionId: workspace[0]!,
      requestedModule: 'conversation-relay',
      conversationThreadId: threadRoom[1]!,
    };
  }

  const personRecord = PERSON_RECORD_PATH.exec(pathname);
  if (personRecord) {
    const params = new URLSearchParams(search);
    const workspace = params.getAll('workspace');
    if (params.size !== 1 || workspace.length !== 1 || !MISSION_ID.test(workspace[0]!)) return null;
    return {
      missionId: workspace[0]!,
      requestedModule: 'person-record',
      personId: personRecord[1]!,
    };
  }

  const moneyRoute = MONEY_CONTINUITY_EXTERNAL_ROUTES.find((candidate) => candidate.pathname === canonicalPath(pathname));
  if (moneyRoute) {
    const params = new URLSearchParams(search);
    const workspace = params.getAll('workspace');
    if (params.size !== 1 || workspace.length !== 1 || !MISSION_ID.test(workspace[0]!)) return null;
    return { missionId: workspace[0]!, requestedModule: 'mission-finance', moneyLens: moneyRoute.lens };
  }

  const route = MISSION_SCOPED_MODULE_ROUTES.find((candidate) => candidate.pathname === canonicalPath(pathname));
  if (!route) return null;
  const params = new URLSearchParams(search);
  const workspace = params.getAll('workspace');
  if (params.size !== 1 || workspace.length !== 1 || !MISSION_ID.test(workspace[0]!)) return null;
  return { missionId: workspace[0]!, requestedModule: route.moduleId };
}

/**
 * Shell destinations inherit only a validated mission scope. Detail links,
 * external URLs, unknown query strings, and every other route pass through
 * unchanged, so navigation never becomes authorization or record persistence.
 */
export function workspaceHrefFor(destination: string, missionId: string | null): string {
  if (missionId === null || !MISSION_ID.test(missionId)) return destination;
  const ownsSingleton =
    MISSION_SCOPED_MODULE_ROUTES.some((candidate) => candidate.pathname === destination) ||
    MONEY_CONTINUITY_EXTERNAL_ROUTES.some((candidate) => candidate.pathname === destination);
  if (!ownsSingleton) return destination;
  return `${destination}?workspace=${encodeURIComponent(missionId)}`;
}
