import { useState } from 'react';
import { Text } from '@fluentui/react-components';
import {
  GridRegular,
  DocumentRegular,
  PeopleRegular,
  ArrowClockwiseRegular,
  DocumentEditRegular,
  MailRegular,
  AlertUrgentRegular,
  TrophyRegular,
  LightbulbRegular,
  SettingsRegular,
  WrenchRegular,
  ShieldTaskRegular,
} from '@fluentui/react-icons';

import { useApp } from '@c3/hooks/useApp';
import { useCapabilities } from '@c3/hooks/useCapabilities';
import type { C3Capabilities, C3Role, C3Screen } from '@c3/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NavItem = {
  id: C3Screen['id'];
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  visibleWhen?: (role: C3Role, caps: C3Capabilities, dataSourceMode: string) => boolean;
};

// ---------------------------------------------------------------------------
// Navigation manifest
// ---------------------------------------------------------------------------

const NAV_ITEMS: NavItem[] = [
  { id: 'command-center', label: 'Command Center',  icon: GridRegular },
  // S24-P1: Temporarily hidden in SP DSM until C3Contracts list is provisioned and validated.
  // Remove this guard (or change to `true`) once IT confirms the list is live and a smoke test passes.
  // PersonProfile contract section is unaffected -- it queries C3Contracts regardless of nav visibility.
  { id: 'contracts',      label: 'Contracts',       icon: DocumentRegular, visibleWhen: (_role, _caps, mode) => mode !== 'sharepoint' },
  { id: 'people',         label: 'People',          icon: PeopleRegular },
  { id: 'renewals',       label: 'Renewals',        icon: ArrowClockwiseRegular, visibleWhen: role => role !== 'visitor' },
  // S20-P0-3: SharePointAmendmentService is a stub -- hide in SP DSM to prevent
  // silent empty-data false positive. Re-enable when SP adapter is implemented.
  { id: 'amendments',     label: 'Amendments',      icon: DocumentEditRegular,   visibleWhen: (_role, _caps, mode) => mode !== 'sharepoint' },
  { id: 'inbox',          label: 'Inbox',           icon: MailRegular,           visibleWhen: role => role !== 'visitor' },
  { id: 'situation-room', label: 'Situation Room',  icon: AlertUrgentRegular },
  // S26-4: Missions hidden in SP DSM until the C3Missions list is provisioned and a hosted
  // smoke test passes. Track in Tech Debt (TD-25). The SP read service is 404-safe, so lifting
  // the guard early degrades to an empty state -- but hidden-until-provisioned is the locked
  // beta-containment pattern (same as Contracts S24-P1 and Amendments S20-P0-3).
  { id: 'missions',       label: 'Missions',        icon: TrophyRegular, visibleWhen: (_role, _caps, mode) => mode !== 'sharepoint' },
  // Temporary S24-P1 guard: Intelligence hidden in SP DSM due to cold-load Fluent UI/React Query crash.
  // Track in Tech Debt (TD-23); re-enable after stabilization (hosted hard-refresh first-click must pass).
  { id: 'intelligence',   label: 'Intelligence',    icon: LightbulbRegular, visibleWhen: (_role, _caps, mode) => mode !== 'sharepoint' },
  { id: 'approvals',      label: 'Approvals',       icon: ShieldTaskRegular,     visibleWhen: role => role !== 'visitor' },
  { id: 'settings',       label: 'Settings',        icon: SettingsRegular,       visibleWhen: (_role, caps) => caps.canManageSettings },
  { id: 'developer-diagnostics', label: 'Diagnostics', icon: WrenchRegular },
];

const ROLE_LABELS: Record<C3Role, string> = {
  owner:      'Owner',
  operations: 'Operations',
  legal:      'Legal',
  finance:    'Finance',
  hr:         'HR',
  management: 'Management',
  visitor:    'Visitor',
};

// ---------------------------------------------------------------------------
// toScreen -- maps any screen id (incl. profile screens) to a navigable root.
// ---------------------------------------------------------------------------

const toScreen = (id: C3Screen['id']): C3Screen => {
  switch (id) {
    case 'command-center':        return { id: 'command-center' };
    case 'contracts':             return { id: 'contracts' };
    case 'people':                return { id: 'people' };
    case 'renewals':              return { id: 'renewals' };
    case 'amendments':            return { id: 'amendments' };
    case 'inbox':                 return { id: 'inbox' };
    case 'situation-room':        return { id: 'situation-room' };
    case 'missions':              return { id: 'missions' };
    case 'intelligence':          return { id: 'intelligence' };
    case 'approvals':             return { id: 'approvals' };
    case 'settings':              return { id: 'settings' };
    case 'contract-profile':      return { id: 'command-center' };
    case 'amendment-profile':     return { id: 'amendments' };
    case 'person-profile':        return { id: 'command-center' };
    case 'developer-diagnostics': return { id: 'developer-diagnostics' };
  }
};

// ---------------------------------------------------------------------------
// NavButton
// ---------------------------------------------------------------------------

type NavButtonProps = {
  item: NavItem;
  active: boolean;
  onClick: () => void;
};

const NavButton = ({ item, active, onClick }: NavButtonProps) => {
  const [hovered, setHovered] = useState(false);
  const Icon = item.icon;

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-current={active ? 'page' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--c3-space-2)',
        width: '100%',
        padding: '9px var(--c3-space-3)',
        borderRadius: 'var(--c3-radius-md)',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: 'inherit',
        fontSize: '13.5px',
        lineHeight: '20px',
        fontWeight: active ? 600 : 400,
        color: active ? '#FFFFFF' : 'rgba(255,255,255,0.72)',
        backgroundColor: active
          ? 'rgba(255,255,255,0.12)'
          : hovered
          ? 'rgba(255,255,255,0.06)'
          : 'transparent',
        boxShadow: active ? 'inset 3px 0 0 var(--c3-brand-80)' : 'none',
        transition:
          'background-color var(--c3-motion-fast) ease, ' +
          'color var(--c3-motion-fast) ease, ' +
          'box-shadow var(--c3-motion-fast) ease',
      }}
    >
      <Icon
        style={{ fontSize: 18, flexShrink: 0, opacity: active ? 1 : 0.75 }}
      />
      <span>{item.label}</span>
    </button>
  );
};

// ---------------------------------------------------------------------------
// NavRail
// ---------------------------------------------------------------------------

export const NavRail = () => {
  const { currentUser, screen, navigate, config } = useApp();
  const capabilities = useCapabilities();

  const visibleItems = NAV_ITEMS.filter(item =>
    item.visibleWhen ? item.visibleWhen(currentUser.c3Role, capabilities, config.dataSourceMode) : true
  );

  const activeId = toScreen(screen.id).id;

  return (
    <nav
      aria-label="Main navigation"
      style={{
        width: 'var(--c3-nav-w)',
        backgroundColor: 'var(--c3-brand-40)',
        color: 'white',
        padding: 'var(--c3-space-4)',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--c3-space-4)',
        flexShrink: 0,
      }}
    >
      {/* Wordmark */}
      <div style={{ padding: '4px var(--c3-space-1)', marginBottom: 'var(--c3-space-1)' }}>
        <Text
          weight="semibold"
          size={600}
          style={{ color: 'white', display: 'block', letterSpacing: '-0.01em' }}
        >
          C3
        </Text>
        <Text
          size={100}
          style={{
            color: 'rgba(255,255,255,0.45)',
            display: 'block',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
        >
          Contract Control Center
        </Text>
      </div>

      {/* Nav items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-1)' }}>
        {visibleItems.map(item => (
          <NavButton
            key={item.id}
            item={item}
            active={activeId === item.id}
            onClick={() => navigate(toScreen(item.id))}
          />
        ))}
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* User identity footer */}
      <div>
        <div
          style={{
            height: 1,
            backgroundColor: 'rgba(255,255,255,0.12)',
            marginBottom: 'var(--c3-space-3)',
          }}
        />
        <div style={{ padding: '0 var(--c3-space-1)' }}>
          <Text
            size={200}
            weight="semibold"
            title={currentUser.email}
            style={{ color: 'rgba(255,255,255,0.88)', display: 'block', marginBottom: 2 }}
          >
            {currentUser.displayName}
          </Text>
          <Text
            size={100}
            style={{
              color: 'rgba(255,255,255,0.42)',
              display: 'block',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            {ROLE_LABELS[currentUser.c3Role]}
          </Text>
        </div>
      </div>
    </nav>
  );
};
