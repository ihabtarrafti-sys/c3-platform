import { useMemo, useState } from 'react';
import { Button, Link, Tab, TabList, Text, useRestoreFocusTarget } from '@fluentui/react-components';

import {
  ActivityTimeline,
  DataRow,
  EmptyState,
  FieldGrid,
  FieldTile,
  PageHeader,
  SectionCard,
  SkeletonBlock,
  SkeletonRows,
  type TimelineEntry,
} from '@c3/components/ui';
import { DaysPill } from '@c3/components/shared/DaysPill';
import { DispositionBadge } from '@c3/components/shared/DispositionBadge';
import { OpsStatusBadge } from '@c3/components/shared/OpsStatusBadge';
import { StageBadge } from '@c3/components/shared/StageBadge';
import { CreateAmendmentPanel } from '@c3/components/shared/CreateAmendmentPanel';
import { StagePipeline } from '@c3/components/shared/StagePipeline';
import { useContract } from '@c3/hooks/useContract';
import { useContractActivities } from '@c3/hooks/useContractActivities';
import { useContractAmendments } from '@c3/hooks/useContractAmendments';
import { useNavigate } from '@c3/hooks/useNavigate';
import { useSpReadOnly } from '@c3/hooks/useSpReadOnly';
import { usePeople } from '@c3/hooks/usePeople';
import type { ContractTab } from '@c3/types';

interface ContractProfileProps {
  contractId: string;
  tab?: ContractTab;
}

const formatDate = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  return value.split('T')[0];
};

const formatMoney = (
  value?: number | null,
  currency?: string | null,
): string | undefined => {
  if (value === undefined || value === null) return undefined;
  return `${currency ?? ''} ${value.toLocaleString()}`.trim();
};

const formatPercent = (value?: number | null): string | undefined => {
  if (value === undefined || value === null) return undefined;
  return `${value}%`;
};

export const ContractProfile = ({
  contractId,
  tab = 'overview',
}: ContractProfileProps) => {
  const { navigate } = useNavigate();
  const isSpReadOnly = useSpReadOnly();
  const { data: contract, isLoading, error } = useContract(contractId);
  const { data: people = [] } = usePeople();
  const {
    data: amendments = [],
    isLoading: amendmentsLoading,
    error: amendmentsError,
  } = useContractAmendments(contractId);

  const {
    data: activities = [],
    isLoading: activitiesLoading,
    error: activitiesError,
  } = useContractActivities(contractId);
  const [activeTab, setActiveTab] = useState<ContractTab>(tab);
  const [amendmentPanelOpen, setAmendmentPanelOpen] = useState(false);
  // S33 Set B: modal trigger becomes a tabster restore target.
  const restoreFocusTarget = useRestoreFocusTarget();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loadedAt = useMemo(() => new Date().toISOString(), [contract]);

  const linkedPerson = people.find(
    p => p.PersonnelCode === contract?.PersonnelCode,
  );

  const timelineEntries: TimelineEntry[] = activities.map(a => ({
    id: a.Id,
    label: a.ActionType,
    actor: a.PerformedBy,
    timestamp: a.Timestamp,
    detail: a.Notes,
  }));

  if (isLoading) {
    return (
      <div
        style={{
          padding: 'var(--c3-space-8)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--c3-space-6)',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--c3-space-2)',
          }}
        >
          <SkeletonBlock height="14px" width="100px" />
          <SkeletonBlock height="32px" width="200px" />
          <SkeletonBlock height="16px" width="280px" />
        </div>
        <SkeletonBlock height="96px" />
        <SkeletonBlock height="40px" width="360px" />
        <SkeletonBlock height="220px" />
        <SkeletonBlock height="220px" />
      </div>
    );
  }

  if (error || !contract) {
    return (
      <div style={{ padding: 'var(--c3-space-8)' }}>
        <EmptyState
          variant="error"
          title="Contract not found"
          description="This contract could not be loaded. It may have been removed or you may not have access."
          action={
            <Button
              appearance="primary"
              onClick={() => navigate({ id: 'contracts' })}
            >
              Back to Contracts
            </Button>
          }
        />
      </div>
    );
  }

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
        title={contract.ContractID}
        subtitle={`${contract.FullName} · ${contract.ContractTypeName}`}
        breadcrumb={[
          { label: 'Contracts', onClick: () => navigate({ id: 'contracts' }) },
        ]}
        actions={
          !isSpReadOnly ? (
            <>
              <Button appearance="subtle">Edit Contract</Button>
              <Button
                appearance="primary"
                onClick={() => setAmendmentPanelOpen(true)}
                {...restoreFocusTarget}
              >
                Add Amendment
              </Button>
            </>
          ) : undefined
        }
        lastUpdated={loadedAt}
      />

      {/* Status hero */}
      <SectionCard title="Status">
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--c3-space-5)',
          }}
        >
          <FieldGrid columns={4}>
            <FieldTile
              label="Stage"
              value={<StageBadge stage={contract.ContractStage1} />}
            />
            <FieldTile
              label="Ops Status"
              value={<OpsStatusBadge status={contract.OpsStatus} />}
            />
            <FieldTile
              label="Disposition"
              value={<DispositionBadge disposition={contract.Disposition1} />}
            />
            <FieldTile
              label="Days to Expiry"
              value={<DaysPill endDate={contract.EndDate} />}
            />
          </FieldGrid>

          {/* Pipeline separator */}
          <div
            style={{
              height: '1px',
              background: 'var(--c3-gray-100)',
              margin: '0 calc(-1 * var(--c3-space-5))',
            }}
          />

          <StagePipeline currentStage={contract.ContractStage1} />
        </div>
      </SectionCard>

      {/* Tab nav */}
      <div
        style={{
          background: 'var(--c3-white)',
          borderRadius: 'var(--c3-radius-md)',
          border: '1px solid var(--c3-gray-200)',
          padding: 'var(--c3-space-1) var(--c3-space-5)',
          boxShadow: 'var(--c3-shadow-1)',
        }}
      >
        <TabList
          selectedValue={activeTab}
          onTabSelect={(_, data) => setActiveTab(data.value as ContractTab)}
        >
          <Tab value="overview">Overview</Tab>
          <Tab value="amendments">Amendments ({amendments.length})</Tab>
          <Tab value="documents">Documents</Tab>
          <Tab value="activity">Activity</Tab>
        </TabList>
      </div>

      {/* Tab content */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--c3-space-5)',
        }}
      >
        {activeTab === 'overview' && (
          <>
            <SectionCard title="Contract Details">
              <FieldGrid columns={4}>
                <FieldTile
                  label="Contract ID"
                  value={contract.ContractID}
                  mono
                />
                <FieldTile
                  label="Contract Type"
                  value={contract.ContractTypeName}
                />
                <FieldTile
                  label="Agreement Category"
                  value={contract.AgreementCategory}
                />
                <FieldTile
                  label="Contract Year"
                  value={contract.ContractYear}
                />
                <FieldTile
                  label="Start Date"
                  value={formatDate(contract.StartDate)}
                  mono
                />
                <FieldTile
                  label="End Date"
                  value={formatDate(contract.EndDate)}
                  mono
                />
                <FieldTile
                  label="Signature Date"
                  value={formatDate(contract.SignatureDate)}
                  mono
                />
                <FieldTile
                  label="Termination Date"
                  value={formatDate(contract.TerminationDate)}
                  mono
                />
              </FieldGrid>
            </SectionCard>

            <SectionCard
              title="Person"
              action={
                linkedPerson ? (
                  <Button
                    appearance="subtle"
                    size="small"
                    onClick={() =>
                      navigate({
                        id: 'person-profile',
                        personId: String(linkedPerson.Id),
                      })
                    }
                  >
                    Open Person
                  </Button>
                ) : undefined
              }
            >
              <FieldGrid columns={4}>
                <FieldTile
                  label="Personnel Code"
                  value={contract.PersonnelCode}
                  mono
                />
                <FieldTile label="Full Name" value={contract.FullName} />
                <FieldTile
                  label="Display Name"
                  value={contract.DisplayName}
                />
                <FieldTile label="IGN" value={contract.IGN} />
                <FieldTile label="Nationality" value={contract.Nationality} />
                <FieldTile label="Team" value={contract.Team} />
                <FieldTile label="Game Title" value={contract.GameTitle} />
                <FieldTile label="Primary Role" value={contract.PrimaryRole} />
              </FieldGrid>
            </SectionCard>

            <SectionCard title="Approval Workflow">
              <FieldGrid columns={4}>
                <FieldTile
                  label="Approval Status"
                  value={contract.ApprovalStatus}
                />
                <FieldTile
                  label="Approval Date"
                  value={formatDate(contract.ApprovalDate)}
                  mono
                />
                <FieldTile label="Approved By" value={contract.ApprovedBy} />
                <FieldTile label="Manager" value={contract.Manager} />
                <FieldTile label="Reviewer" value={contract.Reviewer} />
                <FieldTile label="Approver" value={contract.Approver} />
              </FieldGrid>
            </SectionCard>

            <SectionCard title="Documents">
              <FieldGrid columns={4}>
                <FieldTile
                  label="Document Count"
                  value={contract.DocumentCount}
                />
                <FieldTile
                  label="Amendment Count"
                  value={contract.AmendmentCount}
                />
                <FieldTile
                  label="Primary Document"
                  value={
                    contract.PrimaryDocumentURL ? (
                      <Link
                        href={contract.PrimaryDocumentURL}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open
                      </Link>
                    ) : undefined
                  }
                />
                <FieldTile
                  label="Latest Amendment"
                  value={
                    contract.LatestAmendmentURL ? (
                      <Link
                        href={contract.LatestAmendmentURL}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open
                      </Link>
                    ) : undefined
                  }
                />
              </FieldGrid>
            </SectionCard>

            <SectionCard title="Financial Terms">
              <FieldGrid columns={3}>
                <FieldTile
                  label="Monthly Compensation"
                  value={formatMoney(
                    contract.MonthlyCompensation,
                    contract.CurrencyCode,
                  )}
                />
                <FieldTile label="Currency" value={contract.CurrencyCode} />
                <FieldTile
                  label="Prize Share %"
                  value={formatPercent(contract.PrizeSharePct)}
                />
              </FieldGrid>
            </SectionCard>
          </>
        )}

        {activeTab === 'amendments' && (
          <SectionCard title={`Amendments (${amendments.length})`}>
            {amendmentsLoading && <SkeletonRows count={3} />}

            {amendmentsError && (
              <EmptyState
                compact
                variant="error"
                title="Could not load amendments"
                description="Check your connection and try again."
              />
            )}

            {!amendmentsLoading &&
              !amendmentsError &&
              amendments.length === 0 && (
                <EmptyState
                  compact
                  title="No amendments"
                  description="No amendments are linked to this contract."
                />
              )}

            {!amendmentsLoading &&
              !amendmentsError &&
              amendments.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--c3-space-2)',
                  }}
                >
                  {amendments.map(amendment => (
                    <DataRow
                      key={amendment.Id}
                      mono
                      title={amendment.AmendmentID}
                      subtitle={`${amendment.AmendmentTypeName ?? amendment.AmendmentTypeCode} · ${formatDate(amendment.EffectiveDate) ?? '—'}`}
                      right={
                        <Text
                          size={300}
                          style={{ color: 'var(--c3-gray-500)' }}
                        >
                          {amendment.Status ?? '—'}
                        </Text>
                      }
                      onClick={() =>
                        navigate({
                          id: 'amendment-profile',
                          amendmentId: String(amendment.Id),
                        })
                      }
                    />
                  ))}
                </div>
              )}
          </SectionCard>
        )}

        {activeTab === 'documents' && (
          <SectionCard title="Documents">
            <EmptyState
              compact
              title="Documents not yet available"
              description="Supporting documents and signed files will appear here once the document integration is complete."
            />
          </SectionCard>
        )}

        {activeTab === 'activity' && (
          <SectionCard title="Activity">
            {activitiesLoading && <SkeletonRows count={4} />}

            {activitiesError && (
              <EmptyState
                compact
                variant="error"
                title="Could not load activity"
                description="Check your connection and try again."
              />
            )}

            {/* S33 certified truthfulness: the activity backend/schema is
                DEFERRED (both DSMs return [] unconditionally), so an empty
                timeline must not claim "No activity yet" as if the feature
                were live. Mirrors the honest Documents tab pattern. */}
            {!activitiesLoading &&
              !activitiesError &&
              timelineEntries.length === 0 && (
                <EmptyState
                  compact
                  title="Activity not yet available"
                  description="Contract activity history is not yet supported. Lifecycle events and audit history will appear here once the activity backend is available."
                />
              )}

            {!activitiesLoading &&
              !activitiesError &&
              timelineEntries.length > 0 && (
                <ActivityTimeline entries={timelineEntries} />
              )}
          </SectionCard>
        )}
      </div>

      <CreateAmendmentPanel
        contractId={contractId}
        contractCode={contract.ContractID}
        open={amendmentPanelOpen}
        onDismiss={() => setAmendmentPanelOpen(false)}
      />
    </div>
  );
};
