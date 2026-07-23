/**
 * TableworkPage.tsx — the converted route's wrapper (pivot W1-1).
 *
 * Every screen the pivot moves out of the Fluent AppShell mounts through
 * this: the AppShell's exact session gate (loading → sign-in with the deep
 * link preserved → unprovisioned → the screen; queries mount ONLY once
 * authenticated — the pilot's law), then AppFrame + ContextHeader. The
 * canonical place derives from the route's claim; the working-from band is
 * tenant › record.
 */
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useSession } from '../session';
import { IS_ENTRA } from '../auth';
import { EntraSignIn, AccessNotProvisioned } from '../pages/EntraSignIn';
import { LoginGate } from '../pages/LoginGate';
import { AppFrame } from './AppFrame';
import { ContextHeader } from './ContextHeader';
import { activePlaceFor } from './places';

interface TableworkPageProps {
  /** The record-identity band (e.g. the register's name or the record title). */
  record: string;
  /** The local-section chip (band 4). */
  section?: string;
  /** Page-level intent-bar actions (the shell's own intents always follow). */
  actions?: ReactNode;
  /** Registers get command width (the WIDE_ROUTES law, carried per screen). */
  wide?: boolean;
  children: ReactNode;
}

export function TableworkPage({ record, section, actions, wide, children }: TableworkPageProps) {
  const { status, providerSession, signOut } = useSession();
  const location = useLocation();

  if (status === 'loading') {
    return <div style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}>Loading session...</div>;
  }
  if (status === 'anonymous') {
    const intended = location.pathname + location.search;
    return IS_ENTRA ? <EntraSignIn intendedPath={intended} /> : <LoginGate intendedPath={intended} />;
  }
  if (status === 'unprovisioned') {
    return <AccessNotProvisioned identity={providerSession?.identity ?? 'This account'} onSignOut={() => void signOut()} />;
  }

  return <TableworkScreen record={record} section={section} actions={actions} wide={wide} pathname={location.pathname}>{children}</TableworkScreen>;
}

function TableworkScreen({ record, section, actions, wide, pathname, children }: TableworkPageProps & { pathname: string }) {
  const { me } = useSession();
  const place = activePlaceFor(pathname)?.label ?? 'Home';
  return (
    <AppFrame
      place={place}
      wide={wide}
      actor={{ displayName: me?.displayName ?? 'Member', role: me?.role ?? '', tenantName: me?.tenantSlug ?? '' }}
      header={<ContextHeader place={place} origin={me?.tenantSlug ?? ''} record={record} section={section} actions={actions} />}
    >
      {children}
    </AppFrame>
  );
}
