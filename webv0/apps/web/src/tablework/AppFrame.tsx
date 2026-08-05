/**
 * AppFrame.tsx — THE Tablework shell (pivot W0-1; grown from the Comms pilot).
 *
 * Dawn's frame in structure: skip-link → place-rail → work-frame (ContextHeader
 * + notices + Room + narrow bar) → the Float layer. The rail is PLACE-GROUPED
 * with each place's sections always visible — the flat-nav parity constraint:
 * every e2e spec clicks a `nav-*` testid from wherever it stands, so every
 * destination stays one-click reachable (recorded for Aura).
 *
 * Comms renders only as the ACTIVE place (no standalone home exists yet) —
 * truthful absence beats a dead tab. Planner stays a place-only non-link per
 * contract 02. Seats are SOFT until Wave 2 — the owner may re-seat when he
 * sees Wave 1 (Neural ruling).
 *
 * The load-bearing shell testids (logout, role-display, tenant-indicator,
 * notifications, mode/effects toggles, nav-*) are the AppShell contract,
 * byte-identical — the e2e suite is the behavior oracle.
 */
import { useLayoutEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useSession, useNotify } from '../session';
import { useThemeMode } from '../theme/mode';
import { Room, FloatSurface } from './materials';
import { PLACES, activePlaceFor, placeVisible, visibleSections, type Place } from './places';
import { InboxContext } from './shellInbox';
import { ShellBellButton, ShellBellDrawer } from './ShellBell';
import { ShellSearch } from './ShellSearch';
import { WorkspaceNavigationProvider, useWorkspaceNavigation } from './workspaceNavigation';
import './tablework.css';

export interface TableworkActor {
  displayName: string;
  role: string;
  tenantName: string;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function PlaceRow({ place, active }: { place: Place; active: boolean }) {
  const { me } = useSession();
  const { hrefFor } = useWorkspaceNavigation();
  const caps = me?.capabilities;
  const sections = visibleSections(place, caps);

  if (place.sections.length === 0) {
    if (!place.to) {
      // Planner (place-only, brief pending) and the active Comms row.
      return (
        <span className={active ? 'place-link active' : 'place-link'} aria-current={active ? 'page' : undefined}>
          <span aria-hidden="true">{place.glyph}</span>
          <b>{place.label}</b>
          {place.label === 'Planner' ? <small>Brief pending</small> : null}
        </span>
      );
    }
    return (
      <NavLink
        className={({ isActive }) => (isActive || active ? 'place-link active' : 'place-link')}
        to={hrefFor(place.to)}
        data-testid={place.testId}
      >
        <span aria-hidden="true">{place.glyph}</span>
        <b>{place.label}</b>
      </NavLink>
    );
  }

  const primary = sections[0]!;
  return (
    <div className={active ? 'place-group active' : 'place-group'}>
      <Link className={active ? 'place-link active' : 'place-link'} to={hrefFor(primary.to)} aria-current={active ? 'page' : undefined}>
        <span aria-hidden="true">{place.glyph}</span>
        <b>{place.label}</b>
      </Link>
      <ul className="place-sections">
        {sections.map((s) => (
          <li key={s.to}>
            <NavLink className={({ isActive }) => (isActive ? 'section-link is-current' : 'section-link')} to={hrefFor(s.to)} data-testid={s.testId}>
              {s.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The grouped product map on a Float — the narrow shell's Browse. */
function BrowseFloat({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me } = useSession();
  const { hrefFor } = useWorkspaceNavigation();
  const caps = me?.capabilities;
  return (
    <FloatSurface open={open} onClose={onClose} labelledBy="browse-title">
      <div className="float-header">
        <div>
          <p className="eyebrow">Product map</p>
          <h2 id="browse-title">Browse C3</h2>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="float-body">
        <div className="browse-map">
          {/* Phase B: Comms has a real destination (the Attention Ledger) —
              the exclusion that kept a dead tab honest would now HIDE a live
              one, which is the same lie reversed. Planner still waits. */}
          {PLACES.filter((p) => placeVisible(p, caps) && p.label !== 'Planner').map((place) => {
            const sections = visibleSections(place, caps);
            return (
              <section key={place.label}>
                <p className="search-group">{place.label}</p>
                <div className="float-menu">
                  {(place.to ? [{ label: place.label, to: place.to }] : sections).map((s) => (
                    <Link key={s.to} to={hrefFor(s.to)} onClick={onClose}>
                      <span>
                        <strong>{s.label}</strong>
                      </span>
                      <span aria-hidden="true">→</span>
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </FloatSurface>
  );
}

/** Appearance + identity + sign-out for the narrow shell (the rail is hidden). */
function MoreFloat({ open, onClose, actor }: { open: boolean; onClose: () => void; actor: TableworkActor }) {
  const { signOut } = useSession();
  const { mode, toggleMode, skin, toggleSkin, effectsReduced, toggleEffects } = useThemeMode();
  return (
    <FloatSurface open={open} onClose={onClose} labelledBy="more-title">
      <div className="float-header">
        <div>
          <p className="eyebrow">{actor.tenantName}</p>
          <h2 id="more-title">Account</h2>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="float-body">
        <p className="float-note">
          <strong>{actor.displayName}</strong>
          <br />
          {actor.role}
        </p>
        <div className="message-actions" role="group" aria-label="Appearance" style={{ justifyContent: 'flex-start' }}>
          <button className="quiet-action" type="button" onClick={toggleMode}>
            {mode === 'dark' ? 'Cozy dark' : 'Fresh light'}
          </button>
          <button className="quiet-action" type="button" onClick={toggleEffects}>
            {effectsReduced ? 'Calm effects' : 'Full effects'}
          </button>
          <button
            className="quiet-action"
            type="button"
            onClick={toggleSkin}
            aria-pressed={skin === 'iris'}
            aria-label={skin === 'iris' ? 'Switch to Afterglow face' : 'Switch to Iris face'}
            title={skin === 'iris' ? 'Switch to Afterglow face' : 'Switch to Iris face'}
          >
            {skin === 'iris' ? 'Iris' : 'Afterglow'}
          </button>
        </div>
        <div className="panel-actions">
          <button className="secondary-action" type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>
    </FloatSurface>
  );
}

interface AppFrameProps {
  /** The active place label (fallback when no route claim matches). */
  place: string;
  actor: TableworkActor;
  /** The ContextHeader (first row of the work-frame). */
  header: ReactNode;
  /** Registers get command width; reading surfaces keep the calm measure. */
  wide?: boolean;
  /** A validated mission may keep Finance inside the persistent workspace. */
  workspaceMissionId?: string | null;
  /** Parked workspaces keep their tree but close every top-layer shell surface. */
  active?: boolean;
  children: ReactNode;
}

export function AppFrame({ place, actor, header, wide, workspaceMissionId = null, active = true, children }: AppFrameProps) {
  const { mode, toggleMode, skin, toggleSkin, effectsReduced, toggleEffects } = useThemeMode();
  const { me, signOut } = useSession();
  const { notices, dismiss } = useNotify();
  const location = useLocation();
  const [inboxOpen, setInboxOpen] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useLayoutEffect(() => {
    if (active) return;
    setInboxOpen(false);
    setBrowseOpen(false);
    setMoreOpen(false);
  }, [active]);

  const activePlace = activePlaceFor(location.pathname);
  const activeLabel = activePlace?.label ?? place;
  const caps = me?.capabilities;

  return (
    <WorkspaceNavigationProvider missionId={workspaceMissionId}>
      <InboxContext.Provider value={{ open: inboxOpen, setOpen: setInboxOpen }}>
      <div className="tw-root">
        <a className="skip-link" href="#tw-room">
          Skip to {activeLabel}
        </a>
        <section
          className="app-frame"
          data-tablework="AppFrame"
          data-workspace={workspaceMissionId ? 'mission' : undefined}
          aria-label={`C3 ${actor.tenantName}`}
        >
          <aside className="place-rail work-surface" data-tablework="WorkSurface" data-material="work" aria-label="Product places">
            <a className="brand-lockup" href="#tw-room" aria-label={`C3 ${activeLabel}`}>
              <img src={mode === 'light' ? '/brand/gather-on-light.svg' : '/brand/gather-on-dark.svg'} alt="" />
              <span>
                <strong>C3</strong>
                <small data-testid="tenant-indicator" title="Current organization">
                  {actor.tenantName}
                </small>
              </span>
            </a>
            <nav className="place-map" aria-label="Product map">
              {PLACES.map((p) => {
                // Phase B: Comms carries a real destination now — it renders
                // like every place (the old only-when-active guard is gone
                // with the reason it existed).
                if (!placeVisible(p, caps)) return null;
                return <PlaceRow key={p.label} place={p} active={activePlace?.label === p.label} />;
              })}
            </nav>
            <div className="rail-footer">
              <div className="message-actions" role="group" aria-label="Appearance" style={{ justifyContent: 'flex-start' }}>
                <button
                  type="button"
                  className="mini-action"
                  onClick={toggleMode}
                  data-testid="mode-toggle"
                  aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                  title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                >
                  <span aria-hidden="true">◐</span> {mode === 'dark' ? 'Cozy dark' : 'Fresh light'}
                </button>
                <button
                  type="button"
                  className="mini-action"
                  onClick={toggleEffects}
                  data-testid="effects-toggle"
                  aria-label={effectsReduced ? 'Restore glass effects' : 'Reduce effects (solid surfaces, no blur)'}
                  title={effectsReduced ? 'Restore glass effects' : 'Reduce effects (solid surfaces, no blur)'}
                >
                  <span aria-hidden="true">✦</span> {effectsReduced ? 'Calm effects' : 'Full effects'}
                </button>
                <button
                  type="button"
                  className="mini-action"
                  onClick={toggleSkin}
                  data-testid="skin-toggle"
                  aria-label={skin === 'iris' ? 'Switch to Afterglow face' : 'Switch to Iris face'}
                  title={skin === 'iris' ? 'Switch to Afterglow face' : 'Switch to Iris face'}
                >
                  <span aria-hidden="true">◉</span> {skin === 'iris' ? 'Iris' : 'Afterglow'}
                </button>
              </div>
              <div className="actor-context" aria-label="Current actor and standing">
                <span className="actor-avatar" aria-hidden="true">
                  {initialsOf(actor.displayName)}
                </span>
                <span>
                  <strong>{actor.displayName}</strong>
                  <small data-testid="role-display">{actor.role}</small>
                  <small>{actor.tenantName}</small>
                </span>
              </div>
              <button type="button" className="quiet-action rail-signout" onClick={() => void signOut()} data-testid="logout">
                Sign out
              </button>
            </div>
          </aside>
          <div className="work-frame">
            {header}
            <Room wide={wide}>
              {/* Inside the Room (the Fluent canvas's own placement): the
                  stack scrolls with content and never shifts the work-frame
                  grid — a third grid child displaced the Room row and its
                  content intercepted the stack's clicks (battery-caught). */}
              {notices.length > 0 && (
                <div className="notice-stack" aria-live="polite" data-testid="notifications">
                  {notices.map((n) => (
                    <div key={n.id} className={`notice intent-${n.intent}`}>
                      <span>{n.message}</span>
                      <button className="mini-action" type="button" onClick={() => dismiss(n.id)}>
                        Dismiss
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {children}
            </Room>
            <nav className="narrow-navigation work-surface" data-tablework="AppFrame" data-material="work" aria-label="Primary narrow navigation">
              {caps?.canViewSituation ? (
                <Link to="/situation" aria-current={activePlace?.label === 'Home' ? 'page' : undefined}>
                  <span aria-hidden="true">⌂</span>
                  Home
                </Link>
              ) : null}
              <button type="button" onClick={() => setBrowseOpen(true)}>
                <span aria-hidden="true">◇</span>
                Browse
              </button>
              <button type="button" onClick={() => setInboxOpen(true)}>
                <span aria-hidden="true">✓</span>
                Inbox
              </button>
              {activePlace?.label === 'Comms' ? (
                <a href="#tw-room" aria-current="page">
                  <span aria-hidden="true">✦</span>
                  Comms
                </a>
              ) : null}
              <button type="button" onClick={() => setMoreOpen(true)}>
                <span aria-hidden="true">•••</span>
                More
              </button>
            </nav>
          </div>
          <ShellBellDrawer />
          <BrowseFloat open={browseOpen} onClose={() => setBrowseOpen(false)} />
          <MoreFloat open={moreOpen} onClose={() => setMoreOpen(false)} actor={actor} />
        </section>
      </div>
      </InboxContext.Provider>
    </WorkspaceNavigationProvider>
  );
}

/** The ContextHeader's shell intents: search + the inbox bell (one drawer). */
export function ShellIntents() {
  return (
    <>
      <ShellSearch />
      <ShellBellButton />
    </>
  );
}
