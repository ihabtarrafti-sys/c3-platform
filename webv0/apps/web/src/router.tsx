import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { useSession } from './session';
import { SituationRoomPage } from './pages/SituationRoomPage';
import { AuthCallback } from './pages/AuthCallback';
import { PeoplePage } from './pages/PeoplePage';
import { PersonProfilePage } from './pages/PersonProfilePage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { ApprovalDetailPage } from './pages/ApprovalDetailPage';
import { MembersPage } from './pages/MembersPage';
import { CredentialsPage } from './pages/CredentialsPage';
import { JourneysPage } from './pages/JourneysPage';
import { KitPage } from './pages/KitPage';
import { ApparelPage } from './pages/ApparelPage';
import { MissionsPage } from './pages/MissionsPage';
import { EntitiesPage } from './pages/EntitiesPage';
import { SettingsPage } from './pages/SettingsPage';
import { MissionDetailPage } from './pages/MissionDetailPage';
import { AgreementsPage } from './pages/AgreementsPage';
import { AgreementDetailPage } from './pages/AgreementDetailPage';

/**
 * A real URL router. Deep links and browser refresh resolve to the correct
 * route (SPA fallback in dev/preview, nginx, and Cloudflare Pages).
 *
 * /auth/callback completes the Entra PKCE redirect and sits OUTSIDE the
 * protected shell (it must render before a session exists). All product
 * routes are protected by AppShell: unauthenticated access shows the
 * deliberate sign-in screen with the deep link preserved.
 */
/**
 * The landing surface (Sprint 43): operational roles land in the Situation
 * Room — the cockpit is where work starts; everyone else lands on People.
 */
function HomeRedirect() {
  const { me } = useSession();
  const operational = (me?.capabilities.canSubmitApproval || me?.capabilities.canReviewApproval) ?? false;
  return <Navigate to={operational ? '/situation' : '/people'} replace />;
}

export const router = createBrowserRouter([
  { path: '/auth/callback', element: <AuthCallback /> },
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: 'situation', element: <SituationRoomPage /> },
      { path: 'people', element: <PeoplePage /> },
      { path: 'people/:personId', element: <PersonProfilePage /> },
      { path: 'credentials', element: <CredentialsPage /> },
      { path: 'journeys', element: <JourneysPage /> },
      { path: 'kit', element: <KitPage /> },
      { path: 'apparel', element: <ApparelPage /> },
      { path: 'missions', element: <MissionsPage /> },
      { path: 'missions/:missionId', element: <MissionDetailPage /> },
      { path: 'agreements', element: <AgreementsPage /> },
      { path: 'agreements/:agreementId', element: <AgreementDetailPage /> },
      { path: 'entities', element: <EntitiesPage /> },
      { path: 'approvals', element: <ApprovalsPage /> },
      { path: 'approvals/:approvalId', element: <ApprovalDetailPage /> },
      { path: 'members', element: <MembersPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/people" replace /> },
    ],
  },
]);
