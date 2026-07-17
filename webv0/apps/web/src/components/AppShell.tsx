import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Avatar, Button, MessageBar, MessageBarBody, Spinner, makeStyles } from '@fluentui/react-components';
import { useSession, useNotify } from '../session';
import { useThemeMode } from '../theme/mode';
import { GlobalSearch } from './GlobalSearch';
import { NotificationBell } from './NotificationBell';
import { IS_ENTRA } from '../auth';
import { LoginGate } from '../pages/LoginGate';
import { EntraSignIn, AccessNotProvisioned } from '../pages/EntraSignIn';
import { ENV_LABEL, SHOW_ENV } from '../theme/env';
import '../theme/long-table.css';

/**
 * The C3 shell — signature screen 02, "The Long Table frame" (re-skin
 * chapter). A persistent opaque rail (brand lockup, living navigation held
 * together by the living line, appearance controls, the account corner) plus
 * the room (a sticky room bar and the opaque work surface beneath it).
 *
 * Glass law: nothing in this frame is glass — the rail sits on the sunken
 * ground, the room bar on surface-base. Floating overlays (menus, popovers,
 * the command room) are the only glass, and they live in their own
 * components. The living line means relationship and presence, never alerts.
 *
 * The account corner keeps `role-display` and a directly-visible `logout` —
 * the addPerson e2e contract (never fold them into a disclosure menu).
 */

const useStyles = makeStyles({
  // ── work area (measure preserved from S46: calm 1200 / command 1520) ──
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
  canvasWide: { maxWidth: '1520px' },
  notices: { display: 'flex', flexDirection: 'column', rowGap: '8px', marginBottom: '16px' },
  notice: {
    animationName: 'c3-enter',
    animationDuration: 'var(--c3-dur-enter)',
    animationTimingFunction: 'var(--c3-ease)',
  },
  center: { display: 'flex', justifyContent: 'center', padding: '48px' },
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

function SituationIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 10L14.5 5.5M10 3v2M17 10h-2M10 17v-2M3 10h2" />
      <circle cx="10" cy="10" r="1" fill="currentColor" />
    </svg>
  );
}

function ActivityIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M3 10h3l2-5 3 10 2-7 1.5 2H17" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RecycleBinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M4 6h12M8 6V4.5A1.5 1.5 0 019.5 3h1A1.5 1.5 0 0112 4.5V6M5.5 6l.7 9a1.5 1.5 0 001.5 1.4h4.6a1.5 1.5 0 001.5-1.4l.7-9" />
      <path d="M8.5 12.5l1.5-1.5 1.5 1.5M10 11v3.5" />
    </svg>
  );
}

function IntakeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M10 3v9M6.5 8.5L10 12l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.5 12.5V15a1.5 1.5 0 001.5 1.5h10a1.5 1.5 0 001.5-1.5v-2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="3" y="4.5" width="14" height="12.5" rx="1.5" />
      <path d="M3 8h14M7 3v3M13 3v3" strokeLinecap="round" />
    </svg>
  );
}

function DepartureIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M11 3.5H5.5A1.5 1.5 0 004 5v10a1.5 1.5 0 001.5 1.5H11" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 10h8M14 7l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SubscriptionsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M15.5 7A6 6 0 004.7 5.5M4.5 13A6 6 0 0015.3 14.5" strokeLinecap="round" />
      <path d="M15.5 3.5V7H12M4.5 16.5V13H8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AgreementsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M6 2.5h6.5L16 6v11.5H6z" />
      <path d="M12.5 2.5V6H16M8.5 10h5M8.5 13h5" />
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

function TeamsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="7" cy="7" r="2.5" />
      <circle cx="13.5" cy="8.5" r="2" />
      <path d="M2.5 16c.6-2.6 2.4-4 4.5-4s3.9 1.4 4.5 4M11.5 15.5c.4-1.8 1.6-2.8 3-2.8 1.5 0 2.6 1 3 2.8" />
    </svg>
  );
}

function ClaimsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="3.5" y="4.5" width="13" height="11" rx="1.5" />
      <path d="M6.5 8h7M6.5 11h4" />
      <circle cx="14" cy="12.5" r="1" />
    </svg>
  );
}

function InvoicesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M5 2.5h10v15l-2.5-1.5L10 17.5 7.5 16 5 17.5v-15Z" />
      <path d="M8 6.5h4.5M8 9.5h4.5M8 12.5h2.5" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" />
    </svg>
  );
}

function EntitiesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="3" y="3" width="8" height="14" rx="1" />
      <path d="M11 8h5a1 1 0 0 1 1 1v8h-6M5.5 6h3M5.5 9h3M5.5 12h3M13.5 11h1.5M13.5 14h1.5" />
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

// Register list pages + the cockpit get command width; detail pages (with an
// :id segment) and reading surfaces keep the calm centred measure.
const WIDE_ROUTES = /^\/(situation|people|credentials|journeys|kit|apparel|missions|agreements|entities|approvals|members)$/;

function NavItem({
  to,
  label,
  icon,
  onNavigate,
  testId,
}: {
  to: string;
  label: string;
  icon: React.ReactNode;
  onNavigate: () => void;
  /** Stable machine id when the visible label diverges from it (e.g. Home keeps nav-situation). */
  testId?: string;
}) {
  return (
    <li>
      {/* NavLink stamps aria-current="page" on the active anchor natively. */}
      <NavLink
        to={to}
        className={({ isActive }) => (isActive ? 'lt-navitem is-current' : 'lt-navitem')}
        onClick={onNavigate}
        data-testid={testId ?? `nav-${label.toLowerCase()}`}
      >
        {icon}
        <span>{label}</span>
      </NavLink>
    </li>
  );
}

export function AppShell() {
  const s = useStyles();
  const { status, me, providerSession, signOut } = useSession();
  const { notices, dismiss } = useNotify();
  const { mode, toggleMode, effectsReduced, toggleEffects } = useThemeMode();
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

  const closeNav = () => setNavOpen(false);

  return (
    <div className="lt-shell">
      <aside className={navOpen ? 'lt-rail is-open' : 'lt-rail'} aria-label="C3 navigation">
        <div className="lt-lockup">
          <span className="lt-lockup__mark" aria-hidden="true">
            <img className="lt-lockup__art--dark" src="/brand/gather-on-dark.svg" alt="" width="40" height="30" />
            <img className="lt-lockup__art--light" src="/brand/gather-on-light.svg" alt="" width="40" height="30" />
          </span>
          <span className="lt-lockup__name">C3</span>
          {me?.tenantSlug && (
            <span className="lt-lockup__room" data-testid="tenant-indicator" title="Current organization">
              {me.tenantSlug}
            </span>
          )}
        </div>

        <nav className="lt-nav" aria-label="Primary">
          <span className="lt-living-line" aria-hidden="true" />
          <p className="lt-kicker">Your whole company</p>
          <ul className="lt-navlist">
            {me?.capabilities.canViewSituation && (
              // Screen 03: the label is Home (the war-room name retired); the
              // machine id stays nav-situation — the e2e suite's contract.
              <NavItem to="/situation" label="Home" testId="nav-situation" icon={<SituationIcon />} onNavigate={closeNav} />
            )}
            {me?.capabilities.canViewSituation && (
              <NavItem to="/calendar" label="Calendar" icon={<CalendarIcon />} onNavigate={closeNav} />
            )}
            <NavItem to="/people" label="People" icon={<PeopleIcon />} onNavigate={closeNav} />
            <NavItem to="/credentials" label="Credentials" icon={<CredentialsIcon />} onNavigate={closeNav} />
            <NavItem to="/journeys" label="Journeys" icon={<JourneysIcon />} onNavigate={closeNav} />
            <NavItem to="/kit" label="Kit" icon={<KitIcon />} onNavigate={closeNav} />
            <NavItem to="/apparel" label="Apparel" icon={<ApparelIcon />} onNavigate={closeNav} />
            <NavItem to="/missions" label="Missions" icon={<MissionsIcon />} onNavigate={closeNav} />
            <NavItem to="/teams" label="Teams" icon={<TeamsIcon />} onNavigate={closeNav} />
            {me?.capabilities.canViewFinancials && (
              <NavItem to="/invoices" label="Invoices" icon={<InvoicesIcon />} onNavigate={closeNav} />
            )}
            {me?.capabilities.canViewFinancials && (
              <NavItem to="/subscriptions" label="Subscriptions" icon={<SubscriptionsIcon />} onNavigate={closeNav} />
            )}
            {me?.capabilities.canReadClaims && (
              <NavItem to="/claims" label="Claims" icon={<ClaimsIcon />} onNavigate={closeNav} />
            )}
            {me?.capabilities.canReadAgreements && (
              <NavItem to="/agreements" label="Agreements" icon={<AgreementsIcon />} onNavigate={closeNav} />
            )}
            {me?.capabilities.canManageEntities && (
              <NavItem to="/entities" label="Entities" icon={<EntitiesIcon />} onNavigate={closeNav} />
            )}
            <NavItem to="/approvals" label="Approvals" icon={<ApprovalsIcon />} onNavigate={closeNav} />
            {me?.capabilities.canReadMembers && (
              <NavItem to="/members" label="Members" icon={<MembersIcon />} onNavigate={closeNav} />
            )}
            {me?.capabilities.canManageIntake && (
              <NavItem to="/intake" label="Guest intake" icon={<IntakeIcon />} onNavigate={closeNav} />
            )}
            {me?.capabilities.canViewSituation && (
              <NavItem to="/departures" label="Departures" icon={<DepartureIcon />} onNavigate={closeNav} />
            )}
            {me?.capabilities.canManageEntities && (
              <NavItem to="/activity" label="Activity" icon={<ActivityIcon />} onNavigate={closeNav} />
            )}
            {me?.capabilities.canManageEntities && (
              <NavItem to="/recycle-bin" label="Recycle bin" icon={<RecycleBinIcon />} onNavigate={closeNav} />
            )}
            {me?.capabilities.canManageEntities && (
              <NavItem to="/settings" label="Settings" icon={<SettingsIcon />} onNavigate={closeNav} />
            )}
          </ul>
        </nav>

        <div className="lt-rail-footer">
          <div className="lt-chip-row" role="group" aria-label="Appearance">
            <button
              type="button"
              className="lt-chip"
              onClick={toggleMode}
              data-testid="mode-toggle"
              aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              <span aria-hidden="true">◐</span>
              <span>{mode === 'dark' ? 'Fresh light' : 'Cozy dark'}</span>
            </button>
            <button
              type="button"
              className="lt-chip"
              onClick={toggleEffects}
              data-testid="effects-toggle"
              aria-label={effectsReduced ? 'Restore glass effects' : 'Reduce effects (solid surfaces, no blur)'}
              title={effectsReduced ? 'Restore glass effects' : 'Reduce effects (solid surfaces, no blur)'}
            >
              <span aria-hidden="true">✦</span>
              <span>{effectsReduced ? 'Full effects' : 'Calm effects'}</span>
            </button>
          </div>
          <div className="lt-account">
            <div className="lt-account__row">
              <Avatar name={me?.displayName ?? undefined} size={28} color="neutral" />
              <span className="lt-account__copy">
                <strong>{me?.displayName}</strong>
                <span data-testid="role-display">{me?.role}</span>
              </span>
              <span className="lt-presence" aria-hidden="true" />
            </div>
            <button type="button" className="lt-signout" onClick={() => void signOut()} data-testid="logout">
              Sign out
            </button>
          </div>
        </div>
      </aside>

      {navOpen && <div className="lt-scrim" onClick={closeNav} aria-hidden="true" />}

      <div className="lt-room">
        <header className="lt-roombar">
          <div className="lt-roombar__context">
            <button
              type="button"
              className="lt-menu-button"
              aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
              aria-expanded={navOpen}
              onClick={() => setNavOpen((v) => !v)}
            >
              {navOpen ? 'Close' : 'Menu'}
            </button>
          </div>
          <div className="lt-roombar__actions">
            <GlobalSearch />
            {SHOW_ENV && (
              <span className="lt-env" data-testid="env-badge">
                {ENV_LABEL}
              </span>
            )}
            <NotificationBell />
          </div>
        </header>

        <main className={s.work}>
          <div className={WIDE_ROUTES.test(location.pathname) ? `${s.canvas} ${s.canvasWide}` : s.canvas}>
            {notices.length > 0 && (
              <div className={s.notices} aria-live="polite" data-testid="notifications">
                {notices.map((n) => (
                  <MessageBar key={n.id} intent={n.intent} className={s.notice}>
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
