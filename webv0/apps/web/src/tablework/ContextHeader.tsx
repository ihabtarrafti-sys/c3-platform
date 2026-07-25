/**
 * ContextHeader.tsx — the Tablework context header (the work-frame's first row).
 *
 * Dawn's bands verbatim: canonical Place · working-from trail (origin ›
 * record · section) · the intent bar. The pilot passes real navigation as
 * `actions` (e.g. back to the mission workspace) — no fake intents rendered.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { WorkSurface } from './materials';
import { ShellBellButton } from './ShellBell';
import { ShellSearch } from './ShellSearch';

/**
 * RecordBackLink — a record screen's route back to its register, for the
 * ContextHeader intent bar (ruling #5, 2026-07-25).
 *
 * Breadcrumbs deliberately do NOT port to Tablework (see records.tsx) — but on
 * some detail screens the crumb was the ONLY in-page route back, and dropping
 * it silently is a usability regression wearing a design-system costume. This
 * honours the no-breadcrumbs rule while keeping the way back.
 *
 * MANDATORY on any record screen where the crumb was the only route back —
 * ClaimDetail and MissionFinance at minimum. Optional elsewhere.
 *
 * ⚠️ ONE stable kit-level testid, `record-back-link`, on EVERY record screen —
 * never per-screen or per-destination. Four names for one kit component would
 * re-create the divergence the kit exists to prevent, and one name lets a
 * single helper assert "this record screen has a route back" anywhere. Specs
 * are already route-scoped, so they disambiguate by route, not by testid.
 */
export function RecordBackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link className="intent-button" to={to} data-testid="record-back-link">
      {children}
    </Link>
  );
}

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
