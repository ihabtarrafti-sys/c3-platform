import { useState } from 'react';

import { Badge, Button, Text } from '@fluentui/react-components';
import {
  DataRow,
  EmptyState,
  FieldGrid,
  FieldTile,
  PageHeader,
  SectionCard,
  SkeletonBlock,
} from '@c3/components/ui';
import { DaysPill } from '@c3/components/shared/DaysPill';
import { DispositionBadge } from '@c3/components/shared/DispositionBadge';
import { AddCredentialPanel } from '@c3/components/shared/AddCredentialPanel';
import { ReadinessPanel } from '@c3/components/shared/ReadinessPanel';
import { StageBadge } from '@c3/components/shared/StageBadge';
import { StartJourneyPanel } from '@c3/components/shared/StartJourneyPanel';
import { useNavigate } from '@c3/hooks/useNavigate';
import { useSpReadOnly } from '@c3/hooks/useSpReadOnly';
import { usePerson } from '@c3/hooks/usePerson';
import { usePersonJourneys } from '@c3/hooks/usePersonJourneys';
import { usePersonContracts } from '@c3/hooks/usePersonContracts';
import { usePersonCredentials } from '@c3/hooks/usePersonCredentials';
import { usePersonReadiness } from '@c3/hooks/usePersonReadiness';
import { evaluateOnboardingObligations } from '@c3/protocols';
import type { Credential, CredentialCapability, JourneyStatus, MissionNavContext } from '@c3/types';
import { computeDaysToExpiry } from '@c3/utils/dateUtils';
import { CREDENTIAL_TYPE_LABELS } from '@c3/utils/credentialLabels';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PersonProfileProps {
  personId: string;
  /** Initial tab to display. Defaults to "profile". Pass "readiness" when navigating from the Situation Room. */
  tab?: ProfileTab;
  /**
   * Mission context when navigating from a Mission-scoped gap (M10-4).
   * Passed through to StartJourneyPanel so the panel displays mission context
   * and tags the resulting Journey with MissionID.
   */
  missionContext?: MissionNavContext;
}

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

type ProfileTab = 'profile' | 'readiness';

const TABS: Array<{ id: ProfileTab; label: string }> = [
  { id: 'profile',   label: 'Profile' },
  { id: 'readiness', label: 'Readiness' },
];

// ---------------------------------------------------------------------------
// Profile helpers
// ---------------------------------------------------------------------------

const formatDate = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  return value.split('T')[0];
};

type RenewalVariant = 'default' | 'warning' | 'critical';

const getRenewalVariant = (days: number): RenewalVariant => {
  if (days <= 7)  return 'critical';
  if (days <= 30) return 'warning';
  return 'default';
};

// ---------------------------------------------------------------------------
// Credential display helpers
// ---------------------------------------------------------------------------

const getCredentialLabel = (credential: Credential): string => {
  const base = CREDENTIAL_TYPE_LABELS[credential.Type] ?? 'Credential';
  return credential.SubType ? `${base} — ${credential.SubType}` : base;
};

type CredentialVariant = 'default' | 'warning' | 'critical';

const getCredentialVariant = (expiryDate?: string): CredentialVariant => {
  if (!expiryDate) return 'default';
  const days = computeDaysToExpiry(expiryDate);
  if (days <= 30) return 'critical';
  if (days <= 90) return 'warning';
  return 'default';
};

const formatCredentialExpiry = (expiryDate?: string): string => {
  if (!expiryDate) return 'No expiry';
  const days = computeDaysToExpiry(expiryDate);
  const dateStr = expiryDate.split('T')[0];
  if (days < 0)   return `Expired ${Math.abs(days)}d ago (${dateStr})`;
  if (days === 0) return `Expires today (${dateStr})`;
  if (days <= 90) return `Expires in ${days}d (${dateStr})`;
  return `Valid to ${dateStr}`;
};

// ---------------------------------------------------------------------------
// Journey status helpers
// ---------------------------------------------------------------------------

type JourneyBadgeColor = 'informative' | 'success' | 'warning' | 'danger';

const JOURNEY_BADGE_COLOR: Record<JourneyStatus, JourneyBadgeColor> = {
  Active:    'informative',
  Completed: 'success',
  Suspended: 'warning',
  Cancelled: 'danger',
};

// ---------------------------------------------------------------------------
// PersonProfile
// ---------------------------------------------------------------------------

export const PersonProfile = ({ personId, tab: initialTab, missionContext }: PersonProfileProps) => {
  const { navigate } = useNavigate();
  const isSpReadOnly = useSpReadOnly();
  const [activeTab,          setActiveTab]          = useState<ProfileTab>(initialTab ?? 'profile');
  const [journeyPanelOpen,   setJourneyPanelOpen]   = useState(false);
  const [credentialPanelOpen, setCredentialPanelOpen] = useState(false);
  const [resolveCapability,   setResolveCapability]   = useState<CredentialCapability | undefined>(undefined);

  const handleResolveObligation = (capability: CredentialCapability) => {
    setResolveCapability(capability);
    setCredentialPanelOpen(true);
  };

  const handleCredentialPanelDismiss = () => {
    setCredentialPanelOpen(false);
    setResolveCapability(undefined);
  };

  const { data: person, isLoading, error } = usePerson(personId);
  const { data: contracts    = [] } = usePersonContracts(person?.Id ?? 0);
  const { data: credentials  = [] } = usePersonCredentials(person?.PersonID ?? '');
  const { data: journeys     = [] } = usePersonJourneys(person?.PersonID ?? '');

  // Readiness — fetches credentials internally and evaluates via the protocol.
  // Memoized on credential data; evaluation is null while credentials are loading.
  // usePersonCredentials is also called above (for the credentials list in the
  // Profile tab) — TanStack Query deduplicates the fetch via shared cache key.
  const {
    evaluation,
    isLoading: readinessLoading,
  } = usePersonReadiness(person?.PersonID ?? '', evaluateOnboardingObligations);

  // Onboarding journeys only — the Readiness tab evaluates the Onboarding Protocol.
  // Scoping to type ensures a VisaRenewal or other journey does not suppress the
  // "Start Onboarding Journey" button when no Onboarding journey exists yet.
  const onboardingJourneys = journeys.filter(j => j.Type === 'Onboarding');

  // Show active journey first; fall back to most-recent (e.g. a completed journey).
  // listJourneysForPerson returns most-recent first.
  const journey = onboardingJourneys.find(j => j.Status === 'Active') ?? onboardingJourneys[0] ?? null;

  // Button guard: offer "Start Onboarding Journey" only when no Onboarding journey
  // of any status exists. Once one exists (Active, Completed, Suspended, Cancelled),
  // the button is suppressed — the journey card handles the current state.
  const hasOnboardingJourney = onboardingJourneys.length > 0;

  // Open obligations — passed to StartJourneyPanel for per-obligation assignment (S9-2).
  // Computed from the protocol evaluation; only non-Satisfied obligations need routing.
  const openObligations = evaluation?.obligations
    .filter(o => o.status !== 'Satisfied')
    .map(o => ({
      capability: o.satisfiedByCapability,
      requirement: o.requirement,
      suggestedOwner: o.defaultOwner,
    })) ?? [];

  // ── Loading ──────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div
        style={{
          padding: 'var(--c3-space-8)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--c3-space-4)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-2)' }}>
          <div style={{ height: 12, width: 160, borderRadius: 'var(--c3-radius-sm)', backgroundColor: 'var(--c3-gray-200)' }} />
          <div style={{ height: 32, width: 280, borderRadius: 'var(--c3-radius-sm)', backgroundColor: 'var(--c3-gray-200)' }} />
          <div style={{ height: 16, width: 200, borderRadius: 'var(--c3-radius-sm)', backgroundColor: 'var(--c3-gray-100)' }} />
        </div>
        <SkeletonBlock height="130px" />
        <SkeletonBlock height="100px" />
        <SkeletonBlock height="80px"  />
        <SkeletonBlock height="200px" />
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────

  if (error || !person) {
    return (
      <div
        style={{
          padding: 'var(--c3-space-8)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--c3-space-6)',
        }}
      >
        <PageHeader
          title="Person Profile"
          breadcrumb={[{ label: 'People', onClick: () => navigate({ id: 'people' }) }]}
        />
        <EmptyState
          variant="error"
          title="Could not load person"
          description="This person record may not exist or could not be retrieved."
        />
      </div>
    );
  }

  const profileSubtitle = [person.PersonID, person.IGN].filter(Boolean).join(' · ');

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        padding: 'var(--c3-space-8)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--c3-space-4)',
      }}
    >
      <PageHeader
        title={person.FullName}
        subtitle={profileSubtitle}
        breadcrumb={[{ label: 'People', onClick: () => navigate({ id: 'people' }) }]}
      />

      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--c3-gray-200)',
          gap: 'var(--c3-space-1)',
          marginBottom: 'var(--c3-space-1)',
        }}
      >
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: `var(--c3-space-3) var(--c3-space-4)`,
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.id
                ? '2px solid var(--c3-brand-80)'
                : '2px solid transparent',
              color: activeTab === tab.id
                ? 'var(--c3-brand-80)'
                : 'var(--c3-gray-500)',
              fontWeight: activeTab === tab.id ? 600 : 400,
              fontSize: '14px',
              cursor: 'pointer',
              marginBottom: '-1px',
              transition: [
                `color var(--c3-motion-fast) var(--c3-motion-ease-out)`,
                `border-color var(--c3-motion-fast) var(--c3-motion-ease-out)`,
              ].join(', '),
              userSelect: 'none',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Profile tab ───────────────────────────────────────────────────── */}

      {activeTab === 'profile' && (
        <>
          <SectionCard title="Classification">
            <FieldGrid columns={3}>
              <FieldTile label="Personnel Code" value={person.PersonnelCode} mono />
              <FieldTile label="Primary Role"   value={person.PrimaryRole} />
              <FieldTile label="Department"     value={person.PrimaryDepartment} />
              <FieldTile label="Current Team"   value={person.CurrentTeam} />
              <FieldTile label="Current Game"   value={person.CurrentGameTitle} />
              <FieldTile
                label="Status"
                value={person.IsActive ? 'Active' : 'Inactive'}
              />
            </FieldGrid>
          </SectionCard>

          <SectionCard title="Contract History">
            <FieldGrid columns={3}>
              <FieldTile label="First Contract"  value={formatDate(person.FirstContractDate)} />
              <FieldTile label="Latest Contract" value={formatDate(person.LatestContractDate)} />
              <FieldTile label="Total Contracts" value={person.TotalContracts} />
            </FieldGrid>
          </SectionCard>

          <SectionCard title="Notes">
            <FieldGrid columns={2}>
              <FieldTile label="Notes" value={person.Notes} />
            </FieldGrid>
          </SectionCard>

          <SectionCard
            title={`Credentials (${credentials.length})`}
            action={
              !isSpReadOnly ? (
                <Button
                  appearance="subtle"
                  size="small"
                  onClick={() => {
                    setResolveCapability(undefined);
                    setCredentialPanelOpen(true);
                  }}
                >
                  Add Credential
                </Button>
              ) : undefined
            }
          >
            {credentials.length === 0 ? (
              <EmptyState
                compact
                title="No credentials registered"
                description="Travel documents, visas, and identity credentials will appear here."
                action={
                  !isSpReadOnly ? (
                    <Button
                      appearance="primary"
                      size="small"
                      onClick={() => {
                        setResolveCapability(undefined);
                        setCredentialPanelOpen(true);
                      }}
                    >
                      Add Credential
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-2)' }}>
                {credentials.map(credential => (
                  <DataRow
                    key={credential.CredentialID}
                    title={getCredentialLabel(credential)}
                    subtitle={credential.IssuedBy}
                    variant={getCredentialVariant(credential.ExpiryDate)}
                    right={
                      <span
                        style={{
                          fontSize: '12px',
                          color: getCredentialVariant(credential.ExpiryDate) === 'default'
                            ? 'var(--c3-gray-500)'
                            : getCredentialVariant(credential.ExpiryDate) === 'warning'
                              ? 'var(--c3-warning)'
                              : 'var(--c3-critical)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {formatCredentialExpiry(credential.ExpiryDate)}
                      </span>
                    }
                  />
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title={`Related Contracts (${contracts.length})`}>
            {contracts.length === 0 ? (
              <EmptyState
                compact
                title="No contracts linked"
                description="No contracts are associated with this person."
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-2)' }}>
                {contracts.map(contract => (
                  <DataRow
                    key={contract.Id}
                    title={contract.ContractID}
                    subtitle={contract.ContractTypeName}
                    variant={getRenewalVariant(computeDaysToExpiry(contract.EndDate))}
                    onClick={() =>
                      navigate({ id: 'contract-profile', contractId: String(contract.Id) })
                    }
                    right={
                      <>
                        <StageBadge stage={contract.ContractStage1} />
                        <DispositionBadge disposition={contract.Disposition1} />
                        <DaysPill endDate={contract.EndDate} />
                      </>
                    }
                  />
                ))}
              </div>
            )}
          </SectionCard>
        </>
      )}

      {/* ── Journey panel ────────────────────────────────────────────────────
           Mounted outside the tab tree so the drawer renders regardless of
           which tab is active and does not unmount mid-animation.           */}
      <StartJourneyPanel
        personId={person.PersonID}
        personName={person.FullName}
        open={journeyPanelOpen}
        onDismiss={() => setJourneyPanelOpen(false)}
        obligations={openObligations}
        missionContext={missionContext}
      />

      {/* ── Credential panel ─────────────────────────────────────────────────
           Also mounted outside the tab tree. May be opened from either the
           Credentials tab (no capability hint) or the Readiness tab via a
           Resolve action (with capabilityHint set to the obligation's
           satisfiedByCapability).                                            */}
      <AddCredentialPanel
        personId={person.PersonID}
        open={credentialPanelOpen}
        onDismiss={handleCredentialPanelDismiss}
        capabilityHint={resolveCapability}
      />

      {/* ── Readiness tab ─────────────────────────────────────────────────── */}

      {activeTab === 'readiness' && (
        <>
          {journey === null ? (
            <SectionCard title="Operational Readiness">
              <EmptyState
                compact
                title="No onboarding journey"
                description="Start an onboarding journey to assign an owner, record context, and begin tracking operational readiness."
                action={
                  !hasOnboardingJourney && !isSpReadOnly ? (
                    <Button
                      appearance="primary"
                      onClick={() => setJourneyPanelOpen(true)}
                    >
                      Start Onboarding Journey
                    </Button>
                  ) : undefined
                }
              />
            </SectionCard>
          ) : (
            <>
              {/* Journey context */}
              <SectionCard title="Journey">
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--c3-space-2)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--c3-space-2)' }}>
                    <Badge color={JOURNEY_BADGE_COLOR[journey.Status]} size="small">
                      {journey.Status}
                    </Badge>
                    <Text size={300} style={{ color: 'var(--c3-gray-500)' }}>
                      {journey.JourneyID}
                    </Text>
                  </div>
                  {journey.InitiationReason && (
                    <Text size={300} style={{ color: 'var(--c3-gray-700)' }}>
                      {journey.InitiationReason}
                    </Text>
                  )}
                  <Text size={200} style={{ color: 'var(--c3-gray-500)' }}>
                    Initiated by {journey.InitiatedBy} · {formatDate(journey.InitiatedAt)}
                    {journey.CompletedAt ? ` · Completed ${formatDate(journey.CompletedAt)}` : ''}
                  </Text>
                </div>
              </SectionCard>

              {/* Readiness evaluation */}
              <SectionCard title="Onboarding Obligations">
                {readinessLoading ? (
                  <SkeletonBlock height="120px" />
                ) : evaluation ? (
                  <ReadinessPanel
                    evaluation={evaluation}
                    onResolveObligation={isSpReadOnly ? undefined : handleResolveObligation}
                  />
                ) : (
                  <EmptyState
                    compact
                    title="Unable to evaluate readiness"
                    description="Credential data could not be loaded."
                  />
                )}
              </SectionCard>
            </>
          )}
        </>
      )}

    </div>
  );
};
