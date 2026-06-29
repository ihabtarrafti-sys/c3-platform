/**
 * AppShell — top-level layout container.
 *
 * Renders:
 *   1. MockBanner (conditional) — thin strip shown only when dataSourceMode === 'mock'.
 *      Dismissible per session; no storage, no layout disruption.
 *      Sprint 9 (S9-5).
 *   2. NavRail — left-side navigation.
 *   3. Screen content — routed by screen.id from AppContext.
 */

import { useState } from 'react';
import { Text } from '@fluentui/react-components';
import { Dismiss16Regular } from '@fluentui/react-icons';

import { useApp } from '@c3/hooks/useApp';
import { useHostContext } from '@c3/hosts/HostContext';
import { NavRail } from './NavRail';

import { CommandCenter } from '@c3/screens/CommandCenter';
import { ContractsList } from '@c3/screens/ContractsList';
import { ContractProfile } from '@c3/screens/ContractProfile';
import { PeopleWorkspace } from '@c3/screens/PeopleWorkspace';
import { PersonProfile } from '@c3/screens/PersonProfile';
import { RenewalsCenter } from '@c3/screens/RenewalsCenter';
import { Inbox } from '@c3/screens/Inbox';
import { AmendmentWorkspace } from '@c3/screens/AmendmentWorkspace';
import { AmendmentProfile } from '@c3/screens/AmendmentProfile';
import { Intelligence } from '@c3/screens/Intelligence';
import { SituationRoom } from '@c3/screens/SituationRoom';
import { Settings } from '@c3/screens/Settings';
import { DeveloperDiagnostics } from '@c3/screens/DeveloperDiagnostics';

// ---------------------------------------------------------------------------
// Mock mode banner (S9-5)
// ---------------------------------------------------------------------------

/**
 * Thin strip shown when the app is running against mock data.
 *
 * Purpose: make it immediately obvious to anyone reviewing the platform
 * that they are in demo mode and that any changes (journeys started,
 * credentials added) will not survive a page refresh.
 *
 * Dismissed per session via local React state. No localStorage —
 * the banner returns on every fresh load, which is intentional.
 */
const MockBanner = () => {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--c3-space-2)',
        padding: '6px var(--c3-space-5)',
        backgroundColor: 'var(--c3-gray-900)',
        color: 'var(--c3-gray-300)',
        position: 'relative',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: 'var(--c3-warning)',
          flexShrink: 0,
        }}
      />
      <Text size={200} style={{ color: 'var(--c3-gray-300)', letterSpacing: '0.01em' }}>
        Demo mode · Changes are not persisted
      </Text>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss demo mode banner"
        style={{
          position: 'absolute',
          right: 'var(--c3-space-4)',
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          color: 'var(--c3-gray-500)',
          padding: '2px',
          borderRadius: 'var(--c3-radius-sm)',
          transition: 'color var(--c3-motion-fast) ease',
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLElement).style.color = 'var(--c3-gray-200)';
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLElement).style.color = 'var(--c3-gray-500)';
        }}
      >
        <Dismiss16Regular />
      </button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// AppShell
// ---------------------------------------------------------------------------

export const AppShell = () => {
  const { screen, navigate } = useApp();
  const { dataSourceMode } = useHostContext();

  const renderScreen = () => {
    switch (screen.id) {
      case 'command-center':
        return <CommandCenter />;

      case 'contracts':
        return <ContractsList filter={screen.filter} />;

      case 'contract-profile':
        return <ContractProfile contractId={screen.contractId} tab={screen.tab} />;

      case 'amendment-profile':
        return <AmendmentProfile amendmentId={screen.amendmentId} />;

      case 'people':
        return <PeopleWorkspace filter={screen.filter} />;

      case 'person-profile':
        return <PersonProfile personId={screen.personId} tab={screen.tab} missionContext={screen.missionContext} />;

      case 'renewals':
        return <RenewalsCenter stage={screen.stage} />;

      case 'inbox':
        return <Inbox />;

      case 'amendments':
        return <AmendmentWorkspace contractId={screen.contractId} />;

      case 'intelligence':
        return <Intelligence />;

      case 'situation-room':
        return (
          <SituationRoom
            initialMissionId={screen.missionId}
            onNavigateToPerson={(personId, missionContext) =>
              navigate({ id: 'person-profile', personId, tab: 'readiness', missionContext })
            }
          />
        );

      case 'settings':
        return <Settings />;

      case 'developer-diagnostics':
        return <DeveloperDiagnostics />;

      default:
        return <CommandCenter />;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {dataSourceMode === 'mock' && <MockBanner />}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <NavRail />

        <main
          style={{
            flex: 1,
            overflow: 'auto',
            backgroundColor: '#F8FAFC',
          }}
        >
          {renderScreen()}
        </main>
      </div>
    </div>
  );
};
