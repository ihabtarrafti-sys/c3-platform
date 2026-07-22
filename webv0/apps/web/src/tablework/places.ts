/**
 * places.ts — the Tablework product map (pivot Wave 0, Neural-ruled seats).
 *
 * The v1.3.0 contract locks EIGHT places; the ~20 flat rail destinations seat
 * under them as SECTIONS. The rail renders place-grouped with the sections
 * always visible — the flat-nav parity constraint: every e2e spec navigates by
 * clicking a `nav-*` testid from wherever it stands, so every destination
 * stays one-click reachable (RECORDED for Aura as pivot evidence).
 *
 * SEATS ARE SOFT until Wave 2 — the owner may re-seat any section when he
 * SEES Wave 1 (Neural's ruling; Members already re-seated People→Organization
 * because Person ≠ Member is a deliberate S34 domain boundary and the access
 * register belongs with administration).
 *
 * Gates mirror the Fluent AppShell's nav gating VERBATIM (render-gating only —
 * the API stays the authority). Testids are the AppShell NavItem contract,
 * byte-identical (including the space in 'nav-guest intake').
 */
import type { MeResponse } from '@c3web/api-contracts';

type Caps = MeResponse['capabilities'];

export interface PlaceSection {
  label: string;
  to: string;
  /** The AppShell NavItem testid contract, byte-identical. */
  testId: string;
  gate?: (c: Caps) => boolean;
}

export interface Place {
  label: string;
  glyph: string;
  /** Sections render under the place row; [] = the place row itself is the link. */
  sections: PlaceSection[];
  /** For section-less places: the row's own destination + testid. */
  to?: string;
  testId?: string;
  gate?: (c: Caps) => boolean;
  /** Which pathnames belong to this place (prefix match, longest wins). */
  claims: string[];
}

export const PLACES: ReadonlyArray<Place> = [
  {
    label: 'Home',
    glyph: '⌂',
    sections: [],
    to: '/situation',
    testId: 'nav-situation', // Screen 03: the label is Home; the machine id stays nav-situation — the e2e contract.
    gate: (c) => c.canViewSituation,
    claims: ['/situation'],
  },
  {
    label: 'Operations',
    glyph: '◇',
    sections: [
      { label: 'Missions', to: '/missions', testId: 'nav-missions' },
      { label: 'Teams', to: '/teams', testId: 'nav-teams' },
      { label: 'Calendar', to: '/calendar', testId: 'nav-calendar', gate: (c) => c.canViewSituation },
      { label: 'Departures', to: '/departures', testId: 'nav-departures', gate: (c) => c.canViewSituation },
      { label: 'Guest intake', to: '/intake', testId: 'nav-guest intake', gate: (c) => c.canManageIntake },
    ],
    claims: ['/missions', '/teams', '/calendar', '/departures', '/intake'],
  },
  {
    label: 'People',
    glyph: '○',
    sections: [
      { label: 'People', to: '/people', testId: 'nav-people' },
      { label: 'Credentials', to: '/credentials', testId: 'nav-credentials' },
      { label: 'Journeys', to: '/journeys', testId: 'nav-journeys' },
    ],
    claims: ['/people', '/credentials', '/journeys'],
  },
  {
    label: 'Finance',
    glyph: '¤',
    sections: [
      { label: 'Overview', to: '/missions/finance', testId: 'nav-finance', gate: (c) => c.canViewFinancials },
      { label: 'Invoices', to: '/invoices', testId: 'nav-invoices', gate: (c) => c.canViewFinancials },
      { label: 'Subscriptions', to: '/subscriptions', testId: 'nav-subscriptions', gate: (c) => c.canViewFinancials },
      { label: 'Claims', to: '/claims', testId: 'nav-claims', gate: (c) => c.canReadClaims },
      { label: 'Agreements', to: '/agreements', testId: 'nav-agreements', gate: (c) => c.canReadAgreements },
    ],
    claims: ['/missions/finance', '/invoices', '/subscriptions', '/claims', '/agreements'],
  },
  {
    // Place-only until a locked brief exists (contract 02) — never a dead link.
    label: 'Planner',
    glyph: '□',
    sections: [],
    claims: [],
  },
  {
    // Comms has no standalone home yet (the pilot is mission-anchored): the
    // place renders ONLY as the active place on a comms route — truthful
    // absence elsewhere (a dead tab and a fabricated destination both lie).
    // The Comms-module chapter gives it a real destination.
    label: 'Comms',
    glyph: '✦',
    sections: [],
    claims: ['/missions/:missionId/comms'],
  },
  {
    label: 'Approvals',
    glyph: '✓',
    sections: [],
    to: '/approvals',
    testId: 'nav-approvals',
    claims: ['/approvals'],
  },
  {
    label: 'Organization',
    glyph: '⌘',
    sections: [
      { label: 'Entities', to: '/entities', testId: 'nav-entities', gate: (c) => c.canManageEntities },
      { label: 'Members', to: '/members', testId: 'nav-members', gate: (c) => c.canReadMembers },
      { label: 'Kit', to: '/kit', testId: 'nav-kit' },
      { label: 'Apparel', to: '/apparel', testId: 'nav-apparel' },
      { label: 'Activity', to: '/activity', testId: 'nav-activity', gate: (c) => c.canManageEntities },
      { label: 'Recycle bin', to: '/recycle-bin', testId: 'nav-recycle bin', gate: (c) => c.canManageEntities },
      { label: 'Settings', to: '/settings', testId: 'nav-settings', gate: (c) => c.canManageEntities },
    ],
    claims: ['/entities', '/members', '/kit', '/apparel', '/activity', '/recycle-bin', '/settings'],
  },
];

/** The sections this actor may see (render-gating only). */
export function visibleSections(place: Place, caps: Caps | undefined): PlaceSection[] {
  if (!caps) return [];
  return place.sections.filter((s) => !s.gate || s.gate(caps));
}

/** A place shows when its own gate passes and something under it is reachable. */
export function placeVisible(place: Place, caps: Caps | undefined): boolean {
  if (!caps) return false;
  if (place.gate && !place.gate(caps)) return false;
  if (place.to) return true;
  if (place.sections.length > 0) return visibleSections(place, caps).length > 0;
  // Section-less, destination-less places (Planner; Comms off-route) still
  // RENDER as non-links when unclaimed — the map stays complete and honest.
  return true;
}

/** Which place claims this pathname (longest matching claim wins). */
export function activePlaceFor(pathname: string): Place | null {
  let best: Place | null = null;
  let bestLen = -1;
  for (const place of PLACES) {
    for (const claim of place.claims) {
      const matched =
        claim === '/missions/:missionId/comms'
          ? /^\/missions\/[^/]+\/comms/.test(pathname)
          : pathname === claim || pathname.startsWith(`${claim}/`);
      if (matched && claim.length > bestLen) {
        best = place;
        bestLen = claim.length;
      }
    }
  }
  return best;
}
