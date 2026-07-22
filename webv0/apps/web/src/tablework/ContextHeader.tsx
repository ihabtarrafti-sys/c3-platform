/**
 * ContextHeader.tsx — the Tablework context header (the work-frame's first row).
 *
 * Dawn's bands verbatim: canonical Place · working-from trail (origin ›
 * record · section) · the intent bar. The pilot passes real navigation as
 * `actions` (e.g. back to the mission workspace) — no fake intents rendered.
 */
import type { ReactNode } from 'react';
import { WorkSurface } from './materials';
import { ShellBellButton } from './ShellBell';
import { ShellSearch } from './ShellSearch';

interface ContextHeaderProps {
  /** The canonical Place (pilot: "Comms"). */
  place: string;
  /** Where the actor is working from (pilot: "Mission"). */
  origin: string;
  /** The record identity (pilot: the mission name). */
  record: string;
  /** The local section state chip (pilot: "Mission Thread"). */
  section?: string;
  /** Real affordances for the intent bar (links/buttons). */
  actions?: ReactNode;
}

export function ContextHeader({ place, origin, record, section, actions }: ContextHeaderProps) {
  return (
    <WorkSurface as="header" tier="base" tablework="ContextHeader" className="context-header">
      <div className="canonical-place">
        <span className="context-label">Place</span>
        <strong>{place}</strong>
      </div>
      <div className="working-context">
        <span>
          <small>Working from</small>
          <b>{origin}</b>
        </span>
        <span aria-hidden="true">›</span>
        <strong>{record}</strong>
        {section ? <span className="section-state">{section}</span> : null}
      </div>
      <nav className="intent-bar" aria-label="Global intent">
        {actions}
        {/* The shell's own intents ride every converted route (W0-1): the one
            search box (⌘K) and the inbox bell — one drawer per frame. */}
        <ShellSearch />
        <ShellBellButton />
      </nav>
    </WorkSurface>
  );
}
