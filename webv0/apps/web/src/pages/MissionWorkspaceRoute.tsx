import { Outlet, type RouteObject } from 'react-router-dom';
import { MissionCommsPage } from './MissionCommsPage';
import { MissionDetailPage } from './MissionDetailPage';
import { MissionFinancePage } from './MissionFinancePage';
import { MissionsPage } from './MissionsPage';
export { workspaceRouteTargetOf as missionWorkspaceTargetOf } from '../tablework/workspaceRoutes';
export type { WorkspaceRouteTarget as MissionWorkspaceTarget } from '../tablework/workspaceRoutes';

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
