/**
 * MissionCommsPage.tsx — the Tablework pilot route (Comms UI-1: the shell).
 *
 * /missions/:missionId/comms mounts the FULL Tablework frame OUTSIDE the
 * Fluent AppShell — the two grammars never share a route. The session is the
 * SAME app session (SessionProvider wraps the router in main.tsx): identical
 * auth states, deep-link preservation, /me capabilities.
 *
 * UI-1 renders the frame with placeholder Room content; UI-2 replaces the
 * placeholder with the Thread + Obligation surfaces wired to the slice API.
 */
import { Link, useParams } from 'react-router-dom';
import { useSession } from '../session';
import { useMission } from '../queries';
import { ApiError } from '../api';
import { IS_ENTRA } from '../auth';
import { EntraSignIn, AccessNotProvisioned } from './EntraSignIn';
import { LoginGate } from './LoginGate';
import { AppFrame, ContextHeader, WorkSurface } from '../tablework';

export function MissionCommsPage() {
  const { missionId } = useParams<{ missionId: string }>();
  const { status, providerSession, signOut } = useSession();

  // The AppShell's exact session gate, replicated for the standalone mount.
  // The screen (and its queries) mounts ONLY once authenticated — a query
  // fired pre-auth would 401 and, with the app-wide retry:false, stay stuck.
  if (status === 'loading') {
    return <div style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}>Loading session...</div>;
  }
  if (status === 'anonymous') {
    const intended = `/missions/${missionId}/comms`;
    return IS_ENTRA ? <EntraSignIn intendedPath={intended} /> : <LoginGate intendedPath={intended} />;
  }
  if (status === 'unprovisioned') {
    return <AccessNotProvisioned identity={providerSession?.identity ?? 'This account'} onSignOut={() => void signOut()} />;
  }

  return <MissionCommsScreen missionId={missionId ?? ''} />;
}

function MissionCommsScreen({ missionId }: { missionId: string }) {
  const { me } = useSession();
  // The same query key the mission workspace uses — a warm cache renders instantly.
  const mission = useMission(missionId);

  const record = mission.data?.mission.name ?? missionId;
  const notFound = mission.error instanceof ApiError && mission.error.status === 404;

  return (
    <AppFrame
      place="Comms"
      actor={{
        displayName: me?.displayName ?? 'Member',
        role: me?.role ?? '',
        tenantName: me?.tenantSlug ?? '',
      }}
      header={
        <ContextHeader
          place="Comms"
          origin="Mission"
          record={record}
          section="Mission Thread"
          actions={
            <Link className="intent-button" to={`/missions/${missionId}`}>
              Open mission workspace
            </Link>
          }
        />
      }
    >
      {notFound ? (
        <WorkSurface tier="base" className="comms-surface" aria-labelledby="comms-missing-heading">
          <header className="surface-heading">
            <div>
              <h2 id="comms-missing-heading">This mission is not available</h2>
              <p>The mission does not exist or is outside your access.</p>
            </div>
          </header>
          <p className="boundary-note">
            <Link to="/missions">Back to Operations</Link>
          </p>
        </WorkSurface>
      ) : (
        <WorkSurface tier="raised" className="comms-surface" aria-labelledby="comms-pilot-heading">
          <header className="surface-heading">
            <div>
              <h2 id="comms-pilot-heading">{mission.isLoading ? 'Loading mission...' : record}</h2>
              <p>Mission Thread · readable only within the record boundary</p>
            </div>
          </header>
          <p className="boundary-note">The conversation surface for this mission is not yet available here.</p>
        </WorkSurface>
      )}
    </AppFrame>
  );
}
