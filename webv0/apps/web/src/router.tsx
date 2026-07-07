import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { AuthCallback } from './pages/AuthCallback';
import { PeoplePage } from './pages/PeoplePage';
import { PersonProfilePage } from './pages/PersonProfilePage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { ApprovalDetailPage } from './pages/ApprovalDetailPage';
import { MembersPage } from './pages/MembersPage';

/**
 * A real URL router. Deep links and browser refresh resolve to the correct
 * route (SPA fallback in dev/preview, nginx, and Cloudflare Pages).
 *
 * /auth/callback completes the Entra PKCE redirect and sits OUTSIDE the
 * protected shell (it must render before a session exists). All product
 * routes are protected by AppShell: unauthenticated access shows the
 * deliberate sign-in screen with the deep link preserved.
 */
export const router = createBrowserRouter([
  { path: '/auth/callback', element: <AuthCallback /> },
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/people" replace /> },
      { path: 'people', element: <PeoplePage /> },
      { path: 'people/:personId', element: <PersonProfilePage /> },
      { path: 'approvals', element: <ApprovalsPage /> },
      { path: 'approvals/:approvalId', element: <ApprovalDetailPage /> },
      { path: 'members', element: <MembersPage /> },
      { path: '*', element: <Navigate to="/people" replace /> },
    ],
  },
]);
