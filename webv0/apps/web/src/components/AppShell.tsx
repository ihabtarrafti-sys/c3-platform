import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Avatar,
  Button,
  MessageBar,
  MessageBarBody,
  Spinner,
  makeStyles,
} from '@fluentui/react-components';
import { useSession, useNotify } from '../session';
import { IS_ENTRA } from '../auth';
import { LoginGate } from '../pages/LoginGate';
import { EntraSignIn, AccessNotProvisioned } from '../pages/EntraSignIn';
import { ENV_LABEL, SHOW_ENV } from '../theme/env';

/**
 * The C3 shell — Concept C "Split Authority" (Part A). Three always-present
 * zones when authenticated: the IdentityBar (who you are — Command Black, calm),
 * the NavRail (primary navigation only), and the work area (what you may do).
 * Canonical design authority: c3-governance/product/design/A-PRODUCT-FOUNDATION.md.
 *
 * Increment 1 scope = shell + tokens only. The full Identity dropdown menu and
 * the human-readable RoleBadge (Part A.9: owner -> "Platform Owner") land in the
 * increment that also updates the addPerson E2E, which currently asserts the raw
 * role string on `role-display` and clicks a directly-visible `logout`.
 */

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    backgroundColor: 'var(--c3-paper-white)',
    fontFamily: 'var(--c3-font-base)',
  },

  // ── IdentityBar (top, Command Black) ──────────────────────────────────────
  identityBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    height: 'var(--c3-identitybar-h)',
    flexShrink: 0,
    paddingLeft: '20px',
    paddingRight: '20px',
    backgroundColor: 'var(--c3-command-black)',
    color: 'var(--c3-identity-white)',
  },
  brand: { display: 'flex', alignItems: 'center', gap: '10px' },
  mark: { width: '22px', height: '20px', display: 'block' },
  wordmark: { fontSize: '16px', fontWeight: 600, letterSpacing: '0.02em' },
  tenant: {
    fontFamily: 'var(--c3-font-mono)',
    fontSize: '12.5px',
    color: 'var(--c3-on-dark-70)',
    paddingLeft: '12px',
    borderLeft: '1px solid var(--c3-on-dark-40)',
  },
  spacer: { flexGrow: 1 },
  envBadge: {
    fontFamily: 'var(--c3-font-mono)',
    fontSize: '11px',
    fontWeight: 500,
    letterSpacing: '0.14em',
    color: 'var(--c3-signal-red)',
    border: '1px solid var(--c3-signal-red)',
    borderRadius: 'var(--c3-radius)',
    padding: '2px 8px',
  },
  identity: { display: 'flex', alignItems: 'center', gap: '10px' },
  identityText: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2 },
  identityName: { fontSize: '13px', fontWeight: 600 },
  identityRole: { fontSize: '11px', color: 'var(--c3-on-dark-70)', textTransform: 'capitalize' },
  signOut: {
    color: 'var(--c3-identity-white)',
    minWidth: 'auto',
    ':hover': { color: 'var(--c3-identity-white)', backgroundColor: 'var(--c3-on-dark-hover)' },
    ':hover:active': { color: 'var(--c3-identity-white)' },
  },
  menuButton: {
    display: 'none',
    color: 'var(--c3-identity-white)',
    ':hover': { color: 'var(--c3-identity-white)', backgroundColor: 'var(--c3-on-dark-hover)' },
    '@media (max-width: 899px)': { display: 'inline-flex' },
  },

  // ── body row: NavRail + work ──────────────────────────────────────────────
  body: { display: 'flex', flexGrow: 1, minHeight: 0 },
  navRail: {
    width: 'var(--c3-rail-w)',
    flexShrink: 0,
    backgroundColor: 'var(--c3-identity-white)',
    borderRight: '1px solid var(--c3-hairline)',
    paddingTop: '12px',
    display: 'flex',
    flexDirection: 'column',
    rowGap: '2px',
    '@media (max-width: 899px)': { display: 'none' },
  },
  navRailOpen: {
    '@media (max-width: 899px)': {
      display: 'flex',
      position: 'fixed',
      top: 'var(--c3-identitybar-h)',
      bottom: 0,
      left: 0,
      width: 'var(--c3-rail-w)',
      zIndex: 20,
      boxShadow: 'var(--c3-e2)',
    },
  },
  navLink: { textDecoration: 'none', display: 'block' },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    columnGap: '12px',
    height: '40px',
    paddingLeft: '21px',
    paddingRight: '16px',
    color: 'var(--c3-ink-70)',
    fontSize: '14px',
    fontWeight: 400,
    borderLeft: '3px solid transparent',
    cursor: 'pointer',
    ':hover': { backgroundColor: 'rgba(13,13,13,0.035)' },
  },
  navItemActive: {
    color: 'var(--c3-command-black)',
    fontWeight: 600,
    borderLeftColor: 'var(--c3-signal-red)',
    backgroundColor: 'rgba(13,13,13,0.045)',
  },
  navIcon: { width: '20px', height: '20px', flexShrink: 0 },

  // ── work area ─────────────────────────────────────────────────────────────
  work: { flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' },
  canvas: {
    width: '100%',
    maxWidth: 'var(--c3-content-max)',
    marginLeft: 'auto',
    marginRight: 'auto',
    padding: '32px',
    boxSizing: 'border-box',
    '@media (max-width: 899px)': { padding: '16px' },
  },
  notices: { display: 'flex', flexDirection: 'column', rowGap: '8px', marginBottom: '16px' },
  center: { display: 'flex', justifyContent: 'center', padding: '48px' },
  scrim: {
    display: 'none',
    '@media (max-width: 899px)': {
      display: 'block',
      position: 'fixed',
      inset: 0,
      top: 'var(--c3-identitybar-h)',
      backgroundColor: 'rgba(13,13,13,0.32)',
      zIndex: 10,
    },
  },
});

function PeopleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="7" cy="6" r="2.6" />
      <path d="M2.5 16c0-2.8 2-4.5 4.5-4.5s4.5 1.7 4.5 4.5" />
      <path d="M13 5.6a2.4 2.4 0 0 1 0 4.6M14 11.6c2 .4 3.5 1.9 3.5 4.4" />
    </svg>
  );
}

function ApprovalsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="3.5" y="3" width="13" height="14" rx="1.5" />
      <path d="M6.5 8l1.8 1.8L11.8 6M6.5 13h7" />
    </svg>
  );
}

function CredentialsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="3" y="4" width="14" height="10" rx="1.5" />
      <circle cx="7.5" cy="9" r="1.8" />
      <path d="M11.5 7.5h3M11.5 10.5h3M8.5 14v3l-1-0.8-1 0.8v-3" />
    </svg>
  );
}

function JourneysIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="4.5" cy="15.5" r="1.8" />
      <circle cx="15.5" cy="4.5" r="1.8" />
      <path d="M6 14.5c3-1 2-4.5 5-6.5 1.2-.8 2.4-1 3-1.5" />
    </svg>
  );
}

function KitIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="3" y="7" width="14" height="9" rx="1.5" />
      <path d="M7.5 7V5.5A1.5 1.5 0 0 1 9 4h2a1.5 1.5 0 0 1 1.5 1.5V7M3 11h14" />
    </svg>
  );
}

function ApparelIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M7 4l3 1.5L13 4l3.5 2.5-1.5 2.5-1.5-1V16h-7V8l-1.5 1L3.5 6.5 7 4z" />
    </svg>
  );
}

function MissionsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="10" cy="10" r="6.5" />
      <circle cx="10" cy="10" r="3" />
      <path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3" />
    </svg>
  );
}

function MembersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="10" cy="6" r="2.6" />
      <path d="M5 16c0-2.8 2.2-4.5 5-4.5s5 1.7 5 4.5" />
      <path d="M14.6 3.9l.9.9 1.6-1.7" />
    </svg>
  );
}

function NavItem({
  to,
  label,
  icon,
  onNavigate,
}: {
  to: string;
  label: string;
  icon: React.ReactNode;
  onNavigate: () => void;
}) {
  const s = useStyles();
  return (
    <NavLink to={to} className={s.navLink} onClick={onNavigate}>
      {({ isActive }) => (
        <div
          className={isActive ? `${s.navItem} ${s.navItemActive}` : s.navItem}
          data-testid={`nav-${label.toLowerCase()}`}
          aria-current={isActive ? 'page' : undefined}
        >
          {icon}
          {label}
        </div>
      )}
    </NavLink>
  );
}

export function AppShell() {
  const s = useStyles();
  const { status, me, providerSession, signOut } = useSession();
  const { notices, dismiss } = useNotify();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);

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
      <header className={s.identityBar}>
        <Button
          className={s.menuButton}
          appearance="transparent"
          aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={navOpen}
          onClick={() => setNavOpen((v) => !v)}
        >
          {navOpen ? 'Close' : 'Menu'}
        </Button>
        <div className={s.brand}>
          <img className={s.mark} src="/brand/c3-symbol-white.svg" alt="" aria-hidden="true" />
          <span className={s.wordmark}>C3</span>
        </div>
        {me?.tenantSlug && (
          <span className={s.tenant} data-testid="tenant-indicator" title="Current organization">
            {me.tenantSlug}
          </span>
        )}
        <div className={s.spacer} />
        {SHOW_ENV && (
          <span className={s.envBadge} data-testid="env-badge">
            {ENV_LABEL}
          </span>
        )}
        <div className={s.identity}>
          <Avatar name={me?.displayName ?? undefined} size={28} color="neutral" />
          <div className={s.identityText}>
            <span className={s.identityName}>{me?.displayName}</span>
            <span className={s.identityRole} data-testid="role-display">
              {me?.role}
            </span>
          </div>
        </div>
        <Button appearance="transparent" className={s.signOut} onClick={() => void signOut()} data-testid="logout">
          Sign out
        </Button>
      </header>

      <div className={s.body}>
        {navOpen && <div className={s.scrim} onClick={() => setNavOpen(false)} aria-hidden="true" />}
        <nav
          className={navOpen ? `${s.navRail} ${s.navRailOpen}` : s.navRail}
          aria-label="Primary"
        >
          <NavItem to="/people" label="People" icon={<PeopleIcon className={s.navIcon} />} onNavigate={() => setNavOpen(false)} />
          <NavItem
            to="/credentials"
            label="Credentials"
            icon={<CredentialsIcon className={s.navIcon} />}
            onNavigate={() => setNavOpen(false)}
          />
          <NavItem
            to="/journeys"
            label="Journeys"
            icon={<JourneysIcon className={s.navIcon} />}
            onNavigate={() => setNavOpen(false)}
          />
          <NavItem to="/kit" label="Kit" icon={<KitIcon className={s.navIcon} />} onNavigate={() => setNavOpen(false)} />
          <NavItem to="/apparel" label="Apparel" icon={<ApparelIcon className={s.navIcon} />} onNavigate={() => setNavOpen(false)} />
          <NavItem to="/missions" label="Missions" icon={<MissionsIcon className={s.navIcon} />} onNavigate={() => setNavOpen(false)} />
          <NavItem
            to="/approvals"
            label="Approvals"
            icon={<ApprovalsIcon className={s.navIcon} />}
            onNavigate={() => setNavOpen(false)}
          />
          {me?.capabilities.canReadMembers && (
            <NavItem
              to="/members"
              label="Members"
              icon={<MembersIcon className={s.navIcon} />}
              onNavigate={() => setNavOpen(false)}
            />
          )}
        </nav>

        <main className={s.work}>
          <div className={s.canvas}>
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
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
