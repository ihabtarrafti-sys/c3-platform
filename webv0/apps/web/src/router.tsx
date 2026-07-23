import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { useSession } from './session';
import { HomePage } from './pages/HomePage';
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
import { RecycleBinPage } from './pages/RecycleBinPage';
import { ActivityPage } from './pages/ActivityPage';
import { IntakePage } from './pages/IntakePage';
import { GuestIntakePage } from './pages/GuestIntakePage';
import { CalendarPage } from './pages/CalendarPage';
import { SubscriptionsPage } from './pages/SubscriptionsPage';
import { DeparturesPage } from './pages/DeparturesPage';
import { OnePagerPage } from './pages/OnePagerPage';
import { MissionDetailPage } from './pages/MissionDetailPage';
import { MissionCommsPage } from './pages/MissionCommsPage';
import { MissionFinancePage } from './pages/MissionFinancePage';
import { InvoicesPage } from './pages/InvoicesPage';
import { TeamsPage } from './pages/TeamsPage';
import { TeamDetailPage } from './pages/TeamDetailPage';
import { ClaimsPage } from './pages/ClaimsPage';
import { ClaimDetailPage } from './pages/ClaimDetailPage';
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
 * The landing surface (re-skin chapter, screen 03): operational roles land
 * at Home — where the day starts; everyone else lands on People. The
 * /situation path is kept as the canonical URL (deep links, e2e) — the
 * war-room NAME retired, not the route.
 */
function HomeRedirect() {
  const { me } = useSession();
  const operational = (me?.capabilities.canSubmitApproval || me?.capabilities.canReviewApproval) ?? false;
  return <Navigate to={operational ? '/situation' : '/people'} replace />;
}

export const router = createBrowserRouter([
  { path: '/auth/callback', element: <AuthCallback /> },
  // Track B6: the PUBLIC guest form — OUTSIDE the shell + session (a guest has
  // no account). The tenant is resolved server-side from the token.
  { path: '/intake/:token', element: <GuestIntakePage /> },
  // The Tablework pilot (Comms UI): a standalone frame OUTSIDE the Fluent
  // AppShell — the two grammars never share a route. Same session provider.
  { path: '/missions/:missionId/comms', element: <MissionCommsPage /> },
  // ── The Tablework pivot: converted routes move here WHOLE (coexistence
  // law — grammars never share a route; each converted page carries its own
  // session gate via TableworkPage). Wave 1: the demo spine.
  { path: '/people', element: <PeoplePage /> },
  { path: '/missions', element: <MissionsPage /> },
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: 'situation', element: <HomePage /> },
      { path: 'people/:personId', element: <PersonProfilePage /> },
      { path: 'people/:personId/one-pager', element: <OnePagerPage /> },
      { path: 'credentials', element: <CredentialsPage /> },
      { path: 'journeys', element: <JourneysPage /> },
      { path: 'kit', element: <KitPage /> },
      { path: 'apparel', element: <ApparelPage /> },
      { path: 'missions/finance', element: <MissionFinancePage /> },
      { path: 'missions/:missionId', element: <MissionDetailPage /> },
      { path: 'invoices', element: <InvoicesPage /> },
      { path: 'teams', element: <TeamsPage /> },
      { path: 'teams/:teamId', element: <TeamDetailPage /> },
      { path: 'claims', element: <ClaimsPage /> },
      { path: 'claims/:claimId', element: <ClaimDetailPage /> },
      { path: 'agreements', element: <AgreementsPage /> },
      { path: 'agreements/:agreementId', element: <AgreementDetailPage /> },
      { path: 'entities', element: <EntitiesPage /> },
      { path: 'approvals', element: <ApprovalsPage /> },
      { path: 'approvals/:approvalId', element: <ApprovalDetailPage /> },
      { path: 'members', element: <MembersPage /> },
      { path: 'intake', element: <IntakePage /> },
      { path: 'calendar', element: <CalendarPage /> },
      { path: 'departures', element: <DeparturesPage /> },
      { path: 'subscriptions', element: <SubscriptionsPage /> },
      { path: 'activity', element: <ActivityPage /> },
      { path: 'recycle-bin', element: <RecycleBinPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/people" replace /> },
    ],
  },
]);
