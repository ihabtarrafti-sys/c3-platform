/**
 * AppFrame.tsx — the Tablework shell (pilot: the Comms route only).
 *
 * Dawn's frame verbatim in structure: skip-link → place-rail (brand lockup +
 * the 8-place product map + actor context) → work-frame (ContextHeader + Room
 * + the narrow bottom bar). The other places link BACK to the existing Fluent
 * routes — the pivot then migrates them INTO this frame route by route.
 *
 * Planner has no route yet: it renders as a non-navigating entry with the
 * contract's own "Brief pending" note — a truthful map, not a dead link.
 */
import { Link } from 'react-router-dom';
import { useThemeMode } from '../theme/mode';
import { Room } from './materials';
import './tablework.css';

export interface TableworkActor {
  displayName: string;
  role: string;
  tenantName: string;
}

/** The v1.3.0 product map: the 8 places, in the contract's order. */
const PLACES: ReadonlyArray<{ label: string; glyph: string; href: string | null }> = [
  { label: 'Home', glyph: '⌂', href: '/' },
  { label: 'Operations', glyph: '◇', href: '/missions' },
  { label: 'People', glyph: '○', href: '/people' },
  { label: 'Finance', glyph: '¤', href: '/missions/finance' },
  { label: 'Planner', glyph: '□', href: null },
  { label: 'Comms', glyph: '✦', href: null }, // pilot: Comms IS the current place
  { label: 'Approvals', glyph: '✓', href: '/approvals' },
  { label: 'Organization', glyph: '⌘', href: '/entities' },
];

/** The narrow bottom bar: real destinations only (≤48rem). */
const NARROW_PLACES: ReadonlyArray<{ label: string; glyph: string; href: string | null }> = [
  { label: 'Home', glyph: '⌂', href: '/' },
  { label: 'Operations', glyph: '◇', href: '/missions' },
  { label: 'People', glyph: '○', href: '/people' },
  { label: 'Comms', glyph: '✦', href: null },
  { label: 'Approvals', glyph: '✓', href: '/approvals' },
];

interface AppFrameProps {
  /** The active place label (pilot: "Comms"). */
  place: string;
  actor: TableworkActor;
  /** The ContextHeader (first row of the work-frame). */
  header: React.ReactNode;
  /** Room content. */
  children: React.ReactNode;
}

export function AppFrame({ place, actor, header, children }: AppFrameProps) {
  const { mode } = useThemeMode();
  const initials = actor.displayName
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="tw-root">
      <a className="skip-link" href="#tw-room">
        Skip to {place}
      </a>
      <section className="app-frame" data-tablework="AppFrame" aria-label={`C3 ${actor.tenantName}`}>
        <aside className="place-rail work-surface" data-tablework="WorkSurface" data-material="work" aria-label="Product places">
          <a className="brand-lockup" href="#tw-room" aria-label={`C3 ${place}`}>
            <img src={mode === 'light' ? '/brand/gather-on-light.svg' : '/brand/gather-on-dark.svg'} alt="" />
            <span>
              <strong>C3</strong>
              <small>{actor.tenantName}</small>
            </span>
          </a>
          <nav className="place-map" aria-label="Product map">
            {PLACES.map(({ label, glyph, href }) => {
              const active = label === place;
              if (active || href === null) {
                return (
                  <span key={label} className={active ? 'place-link active' : 'place-link'} aria-current={active ? 'page' : undefined}>
                    <span aria-hidden="true">{glyph}</span>
                    <b>{label}</b>
                    {href === null && !active ? <small>Brief pending</small> : null}
                  </span>
                );
              }
              return (
                <Link key={label} className="place-link" to={href}>
                  <span aria-hidden="true">{glyph}</span>
                  <b>{label}</b>
                </Link>
              );
            })}
          </nav>
          <div className="actor-context" aria-label="Current actor and standing">
            <span className="actor-avatar" aria-hidden="true">
              {initials}
            </span>
            <span>
              <strong>{actor.displayName}</strong>
              <small>{actor.role}</small>
              <small>{actor.tenantName}</small>
            </span>
          </div>
        </aside>
        <div className="work-frame">
          {header}
          <Room>{children}</Room>
          <nav className="narrow-navigation work-surface" data-tablework="AppFrame" data-material="work" aria-label="Primary narrow navigation">
            {NARROW_PLACES.map(({ label, glyph, href }) =>
              href === null ? (
                <a key={label} href="#tw-room" aria-current="page">
                  <span aria-hidden="true">{glyph}</span>
                  {label}
                </a>
              ) : (
                <Link key={label} to={href}>
                  <span aria-hidden="true">{glyph}</span>
                  {label}
                </Link>
              ),
            )}
          </nav>
        </div>
      </section>
    </div>
  );
}
