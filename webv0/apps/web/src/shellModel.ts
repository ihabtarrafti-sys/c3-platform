/**
 * shellModel.ts — the shell's grammar-neutral logic, extracted (pivot Wave 0).
 *
 * ONE source for the search routing table, the palette actions, and the
 * notification recency words — consumed by BOTH the Fluent shell (until its
 * retirement) and the Tablework shell. A second copy of routeFor() would be a
 * second route table (the survey's warning); extraction, not duplication.
 * Behavior-frozen: these values moved here byte-identical from
 * components/GlobalSearch.tsx and components/NotificationBell.tsx.
 */

export const KIND_LABEL: Record<string, string> = {
  person: 'People',
  mission: 'Missions',
  agreement: 'Agreements',
  entity: 'Entities',
  credential: 'Credentials',
  journey: 'Journeys',
  kit: 'Kit',
  apparel: 'Apparel',
  approval: 'Approvals',
  team: 'Teams',
  invoice: 'Invoices',
  claim: 'Claims',
  distribution: 'Distributions',
  document: 'Documents',
  term: 'Agreement terms',
  line: 'P&L lines',
  beneficiary: 'Beneficiaries',
};

/**
 * Where each hit navigates. Child records route through their OWNING record
 * (parentId): a term opens its agreement, a line/distribution its mission, a
 * beneficiary its person, a document whatever owns it. Kinds without a detail
 * page land on their register.
 */
export function routeFor(kind: string, id: string, parentId: string | null): string {
  switch (kind) {
    case 'person':
      return `/people/${id}`;
    case 'mission':
      return `/missions/${id}`;
    case 'agreement':
      return `/agreements/${id}`;
    case 'approval':
      return `/approvals/${id}`;
    case 'team':
      return `/teams/${id}`;
    case 'claim':
      return `/claims/${id}`;
    case 'invoice':
      return '/invoices';
    case 'distribution':
    case 'line':
      return parentId ? `/missions/${parentId}` : '/missions';
    case 'term':
      return parentId ? `/agreements/${parentId}` : '/agreements';
    case 'beneficiary':
      return parentId ? `/people/${parentId}` : '/people';
    case 'document': {
      const [ownerType, ownerId] = (parentId ?? '').split(':');
      switch (ownerType) {
        case 'Agreement':
          return `/agreements/${ownerId}`;
        case 'Mission':
          return `/missions/${ownerId}`;
        case 'Person':
          return `/people/${ownerId}`;
        case 'Claim':
          return `/claims/${ownerId}`;
        case 'Invoice':
          return '/invoices';
        case 'Credential':
          return '/credentials';
        case 'Entity':
          return '/entities';
        default:
          return '/people';
      }
    }
    case 'entity':
      return '/entities';
    case 'credential':
      return '/credentials';
    case 'journey':
      return '/journeys';
    case 'kit':
      return '/kit';
    case 'apparel':
      return '/apparel';
    default:
      return '/people';
  }
}

/** S3.1 command palette: navigation ACTIONS matched on the same surface. */
export const NAV_ACTIONS: ReadonlyArray<{ label: string; route: string }> = [
  { label: 'Go to Home', route: '/situation' },
  { label: 'Go to People', route: '/people' },
  { label: 'Go to Credentials', route: '/credentials' },
  { label: 'Go to Journeys', route: '/journeys' },
  { label: 'Go to Kit', route: '/kit' },
  { label: 'Go to Apparel', route: '/apparel' },
  { label: 'Go to Missions', route: '/missions' },
  { label: 'Go to Mission Finance', route: '/missions/finance' },
  { label: 'Go to Invoices', route: '/invoices' },
  { label: 'Go to Teams', route: '/teams' },
  { label: 'Go to Claims', route: '/claims' },
  { label: 'Go to Agreements', route: '/agreements' },
  { label: 'Go to Entities', route: '/entities' },
  { label: 'Go to Approvals', route: '/approvals' },
  { label: 'Go to Members', route: '/members' },
  { label: 'Go to Settings', route: '/settings' },
];

/** "3m" / "2h" / "5d" / date — honest, compact recency. */
export function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d`;
  return new Date(iso).toISOString().slice(0, 10);
}
