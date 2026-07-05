import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { PeoplePage } from './pages/PeoplePage';
import { PersonProfilePage } from './pages/PersonProfilePage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { ApprovalDetailPage } from './pages/ApprovalDetailPage';

/**
 * A real URL router (replacing the frozen app's screen-state navigation). Deep
 * links and browser refresh resolve to the correct route; the Vite dev/preview
 * server falls back to index.html for every path.
 */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/people" replace /> },
      { path: 'people', element: <PeoplePage /> },
      { path: 'people/:personId', element: <PersonProfilePage /> },
      { path: 'approvals', element: <ApprovalsPage /> },
      { path: 'approvals/:approvalId', element: <ApprovalDetailPage /> },
      { path: '*', element: <Navigate to="/people" replace /> },
    ],
  },
]);
