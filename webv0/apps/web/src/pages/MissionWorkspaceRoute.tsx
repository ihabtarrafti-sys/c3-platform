import { Outlet, type RouteObject } from 'react-router-dom';
import { MissionCommsPage } from './MissionCommsPage';
import { MissionDetailPage } from './MissionDetailPage';
import { MissionFinancePage } from './MissionFinancePage';
import { MissionsPage } from './MissionsPage';

const MISSION_ID = /^MSN-\d{4,}$/;
const MISSION_COMMS_PATH = /^\/missions\/(MSN-\d{4,})\/comms\/?$/;

export interface MissionWorkspaceTarget {
  readonly missionId: string;
  readonly requestedModule: 'mission-current' | 'mission-finance';
}

export function missionWorkspaceTargetOf(pathname: string, search: string): MissionWorkspaceTarget | null {
  const comms = MISSION_COMMS_PATH.exec(pathname);
  if (comms) {
    const params = new URLSearchParams(search);
    const open = params.getAll('open');
    if (params.size > 0 && (params.size !== 1 || open.length !== 1 || open[0] !== 'finance')) return null;
    return {
      missionId: comms[1]!,
      requestedModule: open[0] === 'finance' ? 'mission-finance' : 'mission-current',
    };
  }

  if (pathname !== '/missions/finance' && pathname !== '/missions/finance/') return null;
  const params = new URLSearchParams(search);
  const workspace = params.getAll('workspace');
  if (params.size !== 1 || workspace.length !== 1 || !MISSION_ID.test(workspace[0]!)) return null;
  return { missionId: workspace[0]!, requestedModule: 'mission-finance' };
}

function MissionWorkspaceRoute() {
  return <Outlet />;
}

export const missionRoutes: RouteObject = {
  id: 'missions',
  path: '/missions',
  element: <MissionWorkspaceRoute />,
  children: [
    { id: 'missions-index', index: true, element: <MissionsPage /> },
    { id: 'mission-finance', path: 'finance', element: <MissionFinancePage /> },
    { id: 'mission-comms', path: ':missionId/comms', element: <MissionCommsPage /> },
    { id: 'mission-detail', path: ':missionId', element: <MissionDetailPage /> },
  ],
};
