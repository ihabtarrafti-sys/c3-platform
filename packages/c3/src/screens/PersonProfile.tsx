import { useState } from 'react';

import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Spinner,
  Text,
  Textarea,
  useRestoreFocusTarget,
} from '@fluentui/react-components';
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
import { ApparelProfilePanel } from '@c3/components/shared/ApparelProfilePanel';
import { PersonApprovalHistoryCard } from '@c3/components/shared/PersonApprovalHistoryCard';
import { ReadinessPanel } from '@c3/components/shared/ReadinessPanel';
import { StageBadge } from '@c3/components/shared/StageBadge';
import { StartJourneyPanel } from '@c3/components/shared/StartJourneyPanel';
import { useApp } from '@c3/hooks/useApp';
import { useNavigate } from '@c3/hooks/useNavigate';
import { useCapabilities } from '@c3/hooks/useCapabilities';
import { useToast } from '@c3/hooks/useToast';
import { usePerson } from '@c3/hooks/usePerson';
import { useApparelProfile } from '@c3/hooks/useApparelProfile';
import { usePersonMissions } from '@c3/hooks/usePersonMissions';
import { usePersonJourneys } from '@c3/hooks/usePersonJourneys';
import { usePersonContracts } from '@c3/hooks/usePersonContracts';
import { usePersonCredentials } from '@c3/hooks/usePersonCredentials';
import { useSubmitDeactivationApproval } from '@c3/hooks/useSubmitDeactivationApproval';
import type { DeactivateCredentialInput } from '@c3/hooks/useSubmitDeactivationApproval';
import { usePersonReadiness } from '@c3/hooks/usePersonReadiness';
import { useCompleteJourney } from '@c3/hooks/useCompleteJourney';
import { useSuspendJourney } from '@c3/hooks/useSuspendJourney';
import { useResumeJourney } from '@c3/hooks/useResumeJourney';
import { useCancelJourney } from '@c3/hooks/useCancelJourney';
import { canCancel, canComplete, canResume, canSuspend } from '@c3/services/interfaces/IJourneyService';
import { InvalidTransitionError } from '@c3/services/errors';
import { evaluateOnboardingObligations } from '@c3/protocols';
import type { Credential, CredentialCapability, JourneyStatus, MissionNavContext, MissionStatus } from '@c3/types';
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

type ProfileTab = 'profile' | 'readiness' | 'approvals';

const TABS: Array<{ id: ProfileTab; label: string }> = [
  { id: 'profile',   label: 'Profile' },
  { id: 'readiness', label: 'Readiness' },
  { id: 'approvals', label: 'Approvals' },
];

// ---------------------------------------------------------------------------
// Mission status badge colours (S28-5) — mirrors the MissionWorkspace mapping.
// Kept local until a shared MissionStatusBadge component is extracted.
// ---------------------------------------------------------------------------

const MISSION_STATUS_COLOR: Record<
  MissionStatus,
  'brand' | 'danger' | 'informative' | 'subtle' | 'success' | 'warning'
> = {
  Planning:       'informative',
  FinancePending: 'warning',
  Confirmed:      'brand',
  Active:         'success',
  PostMission:    'informative',
  Settled:        'subtle',
  Canceled:       'danger',
};

// ---------------------------------------------------------------------------
// Journey lifecycle confirm action type
// ---------------------------------------------------------------------------

type JourneyConfirmAction = 'complete' | 'suspend' | 'resume' | 'cancel';

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
  const { navigate }     = useNavigate();
  const { currentUser }  = useApp();
  const { canCreate }    = useCapabilities();
  const toast            = useToast();

  const [activeTab,            setActiveTab]            = useState<ProfileTab>(initialTab ?? 'profile');
  // S33 Set B: modal triggers become tabster restore targets — focus returns
  // to the initiating control after the overlay/dialog closes.
  const restoreFocusTarget = useRestoreFocusTarget();
  const [journeyPanelOpen,     setJourneyPanelOpen]     = useState(false);
  const [credentialPanelOpen,  setCredentialPanelOpen]  = useState(false);
  const [apparelPanelOpen,     setApparelPanelOpen]     = useState(false);
  const [resolveCapability,    setResolveCapability]     = useState<CredentialCapability | undefined>(undefined);

  // Deactivation confirm dialog state (Sprint 23 Phase 1)
  const [deactivateTarget, setDeactivateTarget] = useState<import('@c3/types').Credential | null>(null);
  const [deactivateReason, setDeactivateReason] = useState('');

  // Journey lifecycle confirm dialog state
  const [confirmAction, setConfirmAction] = useState<JourneyConfirmAction | null>(null);
  const [confirmReason, setConfirmReason] = useState('');

  const handleResolveObligation = (capability: CredentialCapability) => {
    setResolveCapability(capability);
    setCredentialPanelOpen(true);
  };

  const handleCredentialPanelDismiss = () => {
    setCredentialPanelOpen(false);
    setResolveCapability(undefined);
  };

  const { data: person, isLoading, error } = usePerson(personId);
  // S32 (TD-32): expose the contracts query status so the Contract History tile can
  // derive the total from CANONICAL rows (never the stored denormalized field) and
  // stay truthfully "Not specified" while contract data is loading/unavailable.
  const { data: contracts    = [], isPending: contractsPending, isError: contractsError } = usePersonContracts(person?.PersonID ?? '');
  const { data: credentials  = [] } = usePersonCredentials(person?.PersonID ?? '');
  const { data: journeys     = [] } = usePersonJourneys(person?.PersonID ?? '');

  // S28-5: apparel profile (null = none on file — a normal state) and mission
  // assignments (composition of cached participants + missions queries).
  // Both read-only; both hooks are frame-zero safe with defaults at boundaries.
  const { data: apparelProfile }  = useApparelProfile(person?.PersonID ?? '');
  const { rows: personMissions }  = usePersonMissions(person?.PersonID ?? '');

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
  const journey = onboardingJourneys.find(j => j.Status === 'Active')
    ?? onboardingJourneys.find(j => j.Status === 'Suspended')
    ?? onboardingJourneys[0]
    ?? null;

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

  // ---------------------------------------------------------------------------
  // Journey lifecycle mutations
  //
  // Role guard: owner and operations may manage journey lifecycle.
  // This is NOT gated on isSpReadOnly — lifecycle transitions are available in
  // both mock and SP modes. isSpReadOnly returns true in SP mode and would hide
  // these actions incorrectly. The explicit role check is the authoritative gate.
  // ---------------------------------------------------------------------------

  const canManageJourneyLifecycle =
    currentUser.c3Role === 'owner' || currentUser.c3Role === 'operations';

  // S29A (ADR-013 Addendum): apparel is a role-gated master-data update.
  // Explicit role check is the authoritative UI gate (HR included by design);
  // SharePoint list permissions are the security boundary.
  const canEditApparel =
    currentUser.c3Role === 'owner' ||
    currentUser.c3Role === 'operations' ||
    currentUser.c3Role === 'hr';

  const completeJourneyMutation = useCompleteJourney();
  const suspendJourneyMutation  = useSuspendJourney();
  const resumeJourneyMutation   = useResumeJourney();
  const cancelJourneyMutation   = useCancelJourney();

  const isTransitionPending =
    completeJourneyMutation.isPending ||
    suspendJourneyMutation.isPending  ||
    resumeJourneyMutation.isPending   ||
    cancelJourneyMutation.isPending;

  // Deactivation hook (Sprint 23 Phase 1)
  const { submitAsync: submitDeactivation, isPending: isDeactivationPending } =
    useSubmitDeactivationApproval();

  const handleOpenConfirm = (action: JourneyConfirmAction) => {
    setConfirmReason('');
    setConfirmAction(action);
  };

  const handleDismissConfirm = () => {
    if (isTransitionPending) return; // block dismiss while in-flight
    setConfirmAction(null);
    setConfirmReason('');
  };

  // ── Deactivation confirm handlers (Sprint 23 Phase 1) ──────────────────

  const handleDeactivateDismiss = () => {
    if (isDeactivationPending) return;
    setDeactivateTarget(null);
    setDeactivateReason('');
  };

  const handleDeactivateConfirm = async () => {
    if (!deactivateTarget || !person) return;
    const input: DeactivateCredentialInput = {
      credentialId:   deactivateTarget.CredentialID,
      holderPersonId: deactivateTarget.HolderPersonID,
      credentialType: deactivateTarget.Type,
      referenceNumber: deactivateTarget.ReferenceNumber,
      reason: deactivateReason.trim(),
    };
    try {
      const outcome = await submitDeactivation(input);
      if (outcome.mode === 'direct') {
        toast.success('Credential deactivated.');
      } else {
        toast.success(`Deactivation submitted: ${outcome.approvalTitle}`);
      }
      setDeactivateTarget(null);
      setDeactivateReason('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('Failed to deactivate credential', msg.slice(0, 200));
    }
  };

  const handleConfirm = async () => {
    if (!journey || !person || !confirmAction) return;

    const base = {
      journeyId:     journey.JourneyID,
      actorLoginName: currentUser.loginName,
      personId:      person.PersonID,
      journeyType:   journey.Type,
    };

    try {
      if (confirmAction === 'complete') {
        await completeJourneyMutation.mutateAsync({
          ...base,
          reason: confirmReason.trim() || undefined,
        });
        toast.success('Journey completed.');
      } else if (confirmAction === 'suspend') {
        await suspendJourneyMutation.mutateAsync({
          ...base,
          reason: confirmReason.trim() || undefined,
        });
        toast.success('Journey suspended.');
      } else if (confirmAction === 'resume') {
        await resumeJourneyMutation.mutateAsync(base);
        toast.success('Journey resumed.');
      } else if (confirmAction === 'cancel') {
        await cancelJourneyMutation.mutateAsync({
          ...base,
          reason: confirmReason.trim() || undefined,
        });
        toast.success('Journey cancelled.');
      }
      setConfirmAction(null);
      setConfirmReason('');
    } catch (err) {
      if (err instanceof InvalidTransitionError) {
        toast.error(
          'Action no longer valid',
          'The journey status has changed. Please refresh.',
        );
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error('Failed to update journey', msg.slice(0, 200));
      }
    }
  };

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

  // ── Confirm dialog content (derives from confirmAction) ──────────────────

  const confirmDialogConfig: Record<
    JourneyConfirmAction,
    { title: string; body: string; showReason: boolean; confirmLabel: string; isDanger: boolean }
  > = {
    complete: {
      title:        'Mark as Completed?',
      body:         `Mark ${journey?.JourneyID ?? 'this journey'} as Completed for ${person.FullName}? The journey will be closed and the action logged.`,
      showReason:   false,
      confirmLabel: 'Mark Completed',
      isDanger:     false,
    },
    suspend: {
      title:        'Suspend Journey?',
      body:         `Suspend ${journey?.JourneyID ?? 'this journey'}? The journey will be paused. It can be resumed or cancelled later.`,
      showReason:   true,
      confirmLabel: 'Suspend',
      isDanger:     false,
    },
    resume: {
      title:        'Resume Journey?',
      body:         `Resume ${journey?.JourneyID ?? 'this journey'}? The journey will return to Active status.`,
      showReason:   false,
      confirmLabel: 'Resume',
      isDanger:     false,
    },
    cancel: {
      title:        'Cancel Journey?',
      body:         `Cancel ${journey?.JourneyID ?? 'this journey'} for ${person.FullName}? The credential gap will remain open until a new journey is started.`,
      showReason:   true,
      confirmLabel: 'Cancel Journey',
      isDanger:     true,
    },
  };

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

          {/* ── Apparel Profile (S28-5 read; S29A role-gated edit) ─────────────
               null = no profile on file (a NORMAL state, never an error or a
               readiness claim); undefined = still loading (tiles render blank). */}
          <SectionCard
            title="Apparel Profile"
            action={
              canEditApparel && apparelProfile !== undefined ? (
                <Button
                  appearance="subtle"
                  size="small"
                  onClick={() => setApparelPanelOpen(true)}
                  {...restoreFocusTarget}
                >
                  {apparelProfile === null ? 'Add profile' : 'Edit'}
                </Button>
              ) : undefined
            }
          >
            {apparelProfile === null ? (
              <EmptyState
                compact
                title="No apparel profile on file."
                description="Apparel sizing has not been recorded for this person."
              />
            ) : (
              <FieldGrid columns={3}>
                <FieldTile label="Jersey Size"    value={apparelProfile?.JerseySize} />
                <FieldTile label="Name on Jersey" value={apparelProfile?.NameOnJersey} mono />
                <FieldTile label="Notes"          value={apparelProfile?.Notes} />
              </FieldGrid>
            )}
          </SectionCard>

          <SectionCard title="Contract History">
            <FieldGrid columns={3}>
              <FieldTile label="First Contract"  value={formatDate(person.FirstContractDate)} />
              <FieldTile label="Latest Contract" value={formatDate(person.LatestContractDate)} />
              {/* S32 (TD-32): canonical count, never the stored TotalContracts field */}
              <FieldTile label="Total Contracts" value={contractsPending || contractsError ? undefined : contracts.length} />
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
              canCreate ? (
                <Button
                  appearance="subtle"
                  size="small"
                  onClick={() => {
                    setResolveCapability(undefined);
                    setCredentialPanelOpen(true);
                  }}
                  {...restoreFocusTarget}
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
                  canCreate ? (
                    <Button
                      appearance="primary"
                      size="small"
                      onClick={() => {
                        setResolveCapability(undefined);
                        setCredentialPanelOpen(true);
                      }}
                      {...restoreFocusTarget}
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
                    action={
                      canManageJourneyLifecycle ? (
                        <Button
                          appearance="subtle"
                          size="small"
                          style={{ color: 'var(--c3-critical)', flexShrink: 0 }}
                          disabled={isDeactivationPending}
                          onClick={() => {
                            setDeactivateTarget(credential);
                            setDeactivateReason('');
                          }}
                          {...restoreFocusTarget}
                        >
                          Deactivate
                        </Button>
                      ) : undefined
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
                      navigate({ id: 'contract-profile', contractId: contract.ContractID })
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

          {/* ── Missions (S28-5) — read-only mission assignments ──────────────
               Rows navigate to the Situation Room with the mission pre-scoped
               (readiness context is what an operator wants from here). */}
          <SectionCard title={`Missions (${personMissions.length})`}>
            {personMissions.length === 0 ? (
              <EmptyState
                compact
                title="Not assigned to any missions."
                description="Mission assignments will appear here once this person is added to a mission."
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-2)' }}>
                {personMissions.map(({ mission, role }) => (
                  <DataRow
                    key={mission.MissionID}
                    title={mission.MissionID}
                    subtitle={`${mission.Name} · ${mission.Span.StartDate} → ${mission.Span.EndDate}`}
                    onClick={() =>
                      navigate({ id: 'situation-room', missionId: mission.MissionID })
                    }
                    right={
                      <>
                        <Badge appearance="outline">{role}</Badge>
                        <Badge color={MISSION_STATUS_COLOR[mission.Status]}>{mission.Status}</Badge>
                      </>
                    }
                  />
                ))}
              </div>
            )}
          </SectionCard>
        </>
      )}

      {/* ── Apparel profile panel (S29A) — mounted outside the tab tree ───── */}
      <ApparelProfilePanel
        personId={person.PersonID}
        personName={person.FullName}
        existing={apparelProfile ?? null}
        open={apparelPanelOpen}
        onDismiss={() => setApparelPanelOpen(false)}
      />

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

      {/* ── Journey lifecycle confirm dialog ─────────────────────────────────
           Mounted outside the tab tree — must survive tab switches.
           Only renders when confirmAction is set (a transition was requested).  */}
      {confirmAction && (
        <Dialog
          open={!!confirmAction}
          onOpenChange={(_e, data) => { if (!data.open) handleDismissConfirm(); }}
        >
          <DialogSurface>
            <DialogBody>
              <DialogTitle>{confirmDialogConfig[confirmAction].title}</DialogTitle>
              <DialogContent>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-3)' }}>
                  <Text size={300} style={{ color: 'var(--c3-gray-700)' }}>
                    {confirmDialogConfig[confirmAction].body}
                  </Text>
                  {confirmDialogConfig[confirmAction].showReason && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-1)' }}>
                      <Text size={200} style={{ color: 'var(--c3-gray-500)' }}>
                        Reason (optional — recorded in journey log)
                      </Text>
                      <Textarea
                        value={confirmReason}
                        onChange={(_e, data) => setConfirmReason(data.value)}
                        placeholder={
                          confirmAction === 'suspend'
                            ? 'e.g. Waiting for visa documentation'
                            : 'e.g. Journey no longer required'
                        }
                        resize="vertical"
                        rows={2}
                        disabled={isTransitionPending}
                      />
                    </div>
                  )}
                </div>
              </DialogContent>
              <DialogActions>
                <Button
                  appearance="secondary"
                  onClick={handleDismissConfirm}
                  disabled={isTransitionPending}
                >
                  {confirmAction === 'cancel' ? 'Go Back' : 'Cancel'}
                </Button>
                <Button
                  appearance={confirmDialogConfig[confirmAction].isDanger ? 'primary' : 'primary'}
                  style={
                    confirmDialogConfig[confirmAction].isDanger
                      ? { backgroundColor: 'var(--c3-critical, #DC2626)', color: '#ffffff', border: 'none' }
                      : undefined
                  }
                  onClick={() => { void handleConfirm(); }}
                  disabled={isTransitionPending}
                  icon={isTransitionPending ? <Spinner size="tiny" /> : undefined}
                >
                  {isTransitionPending ? 'Updating…' : confirmDialogConfig[confirmAction].confirmLabel}
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}

      {/* ── Credential deactivation confirm dialog (Sprint 23 Phase 1) ───────
           Mounted outside the tab tree. Opens when the Deactivate button is
           clicked on a credential row. Requires a non-empty reason.
           Mock DSM: deactivates directly. SP DSM: submits approval.         */}
      {deactivateTarget && (
        <Dialog
          open={!!deactivateTarget}
          onOpenChange={(_e, data) => { if (!data.open) handleDeactivateDismiss(); }}
        >
          <DialogSurface>
            <DialogBody>
              <DialogTitle>Deactivate Credential?</DialogTitle>
              <DialogContent>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-3)' }}>
                  <Text size={300} style={{ color: 'var(--c3-gray-700)' }}>
                    Deactivate{' '}
                    <strong>{getCredentialLabel(deactivateTarget)}</strong>{' '}
                    ({deactivateTarget.ReferenceNumber}) for {person?.FullName ?? deactivateTarget.HolderPersonID}?
                    The credential will be marked inactive and will no longer satisfy obligations.
                  </Text>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-1)' }}>
                    <Text size={200} style={{ color: 'var(--c3-gray-500)' }}>
                      Reason (required — recorded in the approval log)
                    </Text>
                    <Textarea
                      value={deactivateReason}
                      onChange={(_e, data) => setDeactivateReason(data.value)}
                      placeholder="e.g. Document expired and superseded, or document was revoked"
                      resize="vertical"
                      rows={2}
                      disabled={isDeactivationPending}
                    />
                  </div>
                </div>
              </DialogContent>
              <DialogActions>
                <Button
                  appearance="secondary"
                  onClick={handleDeactivateDismiss}
                  disabled={isDeactivationPending}
                >
                  Go Back
                </Button>
                <Button
                  appearance="primary"
                  style={{ backgroundColor: 'var(--c3-critical, #DC2626)', color: '#ffffff', border: 'none' }}
                  onClick={() => { void handleDeactivateConfirm(); }}
                  disabled={isDeactivationPending || !deactivateReason.trim()}
                  icon={isDeactivationPending ? <Spinner size="tiny" /> : undefined}
                >
                  {isDeactivationPending ? 'Processing…' : 'Deactivate'}
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}

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
                  !hasOnboardingJourney ? (
                    <Button
                      appearance="primary"
                      onClick={() => setJourneyPanelOpen(true)}
                      {...restoreFocusTarget}
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
                    gap: 'var(--c3-space-3)',
                  }}
                >
                  {/* Status + ID row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--c3-space-2)' }}>
                    <Badge color={JOURNEY_BADGE_COLOR[journey.Status]} size="small">
                      {journey.Status}
                    </Badge>
                    <Text size={300} style={{ color: 'var(--c3-gray-500)' }}>
                      {journey.JourneyID}
                    </Text>
                  </div>

                  {/* Initiation reason */}
                  {journey.InitiationReason && (
                    <Text size={300} style={{ color: 'var(--c3-gray-700)' }}>
                      {journey.InitiationReason}
                    </Text>
                  )}

                  {/* Metadata line */}
                  <Text size={200} style={{ color: 'var(--c3-gray-500)' }}>
                    Initiated by {journey.InitiatedBy} · {formatDate(journey.InitiatedAt)}
                    {journey.CompletedAt ? ` · Completed ${formatDate(journey.CompletedAt)}` : ''}
                  </Text>

                  {/* ── Journey lifecycle actions ─────────────────────────────────
                       Visible only to owner and operations roles.
                       NOT gated on isSpReadOnly — that guard returns true in SP mode
                       and would incorrectly hide these actions. Role is the gate.
                       Each button is conditionally rendered per transition guard.    */}
                  {canManageJourneyLifecycle && (
                    <div
                      style={{
                        display: 'flex',
                        gap: 'var(--c3-space-2)',
                        flexWrap: 'wrap',
                        paddingTop: 'var(--c3-space-1)',
                        borderTop: '1px solid var(--c3-gray-100)',
                      }}
                    >
                      {canComplete(journey.Status) && (
                        <Button
                          appearance="subtle"
                          size="small"
                          disabled={isTransitionPending}
                          onClick={() => handleOpenConfirm('complete')}
                        >
                          Mark Completed
                        </Button>
                      )}
                      {canSuspend(journey.Status) && (
                        <Button
                          appearance="subtle"
                          size="small"
                          disabled={isTransitionPending}
                          onClick={() => handleOpenConfirm('suspend')}
                        >
                          Suspend
                        </Button>
                      )}
                      {canResume(journey.Status) && (
                        <Button
                          appearance="subtle"
                          size="small"
                          disabled={isTransitionPending}
                          onClick={() => handleOpenConfirm('resume')}
                        >
                          Resume
                        </Button>
                      )}
                      {canCancel(journey.Status) && (
                        <Button
                          appearance="subtle"
                          size="small"
                          disabled={isTransitionPending}
                          style={{ color: 'var(--c3-critical)' }}
                          onClick={() => handleOpenConfirm('cancel')}
                        >
                          Cancel Journey
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </SectionCard>

              {/* Readiness evaluation */}
              <SectionCard title="Onboarding Obligations">
                {readinessLoading ? (
                  <SkeletonBlock height="120px" />
                ) : evaluation ? (
                  <ReadinessPanel
                    evaluation={evaluation}
                    onResolveObligation={canCreate ? handleResolveObligation : undefined}
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

      {/* ── Approvals tab (S21-P2) ────────────────────────────────────────── */}

      {activeTab === 'approvals' && (
        <PersonApprovalHistoryCard personId={person.PersonID} />
      )}

    </div>
  );
};
