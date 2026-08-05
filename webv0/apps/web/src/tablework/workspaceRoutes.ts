import type { MissionCommandModuleId } from './missionCommandModel';

const MISSION_ID = /^MSN-\d{4,}$/;
const MISSION_COMMS_PATH = /^\/missions\/(MSN-\d{4,})\/comms\/?$/;
const THREAD_ROOM_PATH = /^\/comms\/threads\/(THR-\d{4,})\/?$/;
type PersistentWorkspaceModuleId = Exclude<MissionCommandModuleId, 'conversation-relay'>;

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
    | 'mission-finance'
    | 'approvals-register'
    | 'calendar-horizon'
    | 'command-constellation'
    | 'command-attention'
  >;
}> = [
  { pathname: '/missions/finance', moduleId: 'mission-finance' },
  { pathname: '/approvals', moduleId: 'approvals-register' },
  { pathname: '/calendar', moduleId: 'calendar-horizon' },
  { pathname: '/situation', moduleId: 'command-constellation' },
  { pathname: '/comms', moduleId: 'command-attention' },
];

export type WorkspaceRouteTarget =
  | {
      readonly missionId: string;
      readonly requestedModule: Exclude<MissionCommandModuleId, 'conversation-relay'>;
      readonly conversationThreadId?: never;
    }
  | {
      readonly missionId: string;
      readonly requestedModule: 'conversation-relay';
      /** Runtime identity for the one transient conversation slot. It travels
       * in the route and live React tree, never in persisted window state. */
      readonly conversationThreadId: string;
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
    return {
      missionId: comms[1]!,
      requestedModule: open.length === 1 ? COMMS_OPEN_MODULES[open[0]!]! : 'mission-current',
    };
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
  const route = MISSION_SCOPED_MODULE_ROUTES.find((candidate) => candidate.pathname === destination);
  if (!route) return destination;
  return `${destination}?workspace=${encodeURIComponent(missionId)}`;
}
