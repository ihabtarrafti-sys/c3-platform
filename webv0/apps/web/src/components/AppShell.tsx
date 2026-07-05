import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Badge,
  Button,
  MessageBar,
  MessageBarBody,
  Spinner,
  Text,
  Title3,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useSession, useNotify } from '../session';
import { IS_ENTRA } from '../auth';
import { LoginGate } from '../pages/LoginGate';
import { EntraSignIn, AccessNotProvisioned } from '../pages/EntraSignIn';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', minHeight: '100vh', fontFamily: tokens.fontFamilyBase },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '12px 20px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  nav: { display: 'flex', gap: '8px', flexGrow: 1 },
  link: { textDecoration: 'none' },
  main: { padding: '20px', flexGrow: 1 },
  notices: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 20px 0' },
  center: { display: 'flex', justifyContent: 'center', padding: '48px' },
  spacer: { flexGrow: 1 },
});

function NavItem({ to, label }: { to: string; label: string }) {
  const s = useStyles();
  return (
    <NavLink to={to} className={s.link}>
      {({ isActive }) => (
        <Button appearance={isActive ? 'primary' : 'subtle'} data-testid={`nav-${label.toLowerCase()}`}>
          {label}
        </Button>
      )}
    </NavLink>
  );
}

export function AppShell() {
  const s = useStyles();
  const { status, me, providerSession, signOut } = useSession();
  const { notices, dismiss } = useNotify();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className={s.center}>
        <Spinner label="Loading session..." />
      </div>
    );
  }

  if (status === 'anonymous') {
    // Preserve the intended deep link: after sign-in the same route renders.
    const intended = location.pathname + location.search;
    // IS_ENTRA is a build-time constant: the dev sign-in UI is dead-code-
    // eliminated from entra (production) bundles.
    return IS_ENTRA ? <EntraSignIn intendedPath={intended} /> : <LoginGate intendedPath={intended} />;
  }

  if (status === 'unprovisioned') {
    return <AccessNotProvisioned identity={providerSession?.identity ?? 'This account'} onSignOut={() => void signOut()} />;
  }

  return (
    <div className={s.root}>
      <header className={s.header}>
        <Title3>C3 Web V0</Title3>
        <nav className={s.nav} aria-label="Primary">
          <NavItem to="/people" label="People" />
          <NavItem to="/approvals" label="Approvals" />
        </nav>
        <Text data-testid="role-display">
          {me?.displayName} &middot; <Badge appearance="tint">{me?.role}</Badge> &middot; {me?.tenantSlug}
        </Text>
        <Button appearance="secondary" onClick={() => void signOut()} data-testid="logout">
          Sign out
        </Button>
      </header>

      {notices.length > 0 && (
        <div className={s.notices} aria-live="polite" data-testid="notifications">
          {notices.map((n) => (
            <MessageBar key={n.id} intent={n.intent}>
              <MessageBarBody>{n.message}</MessageBarBody>
              <Button size="small" appearance="transparent" onClick={() => dismiss(n.id)}>
                Dismiss
              </Button>
            </MessageBar>
          ))}
        </div>
      )}

      <main className={s.main}>
        <Outlet />
      </main>
    </div>
  );
}
