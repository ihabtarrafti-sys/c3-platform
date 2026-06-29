import { useMemo } from 'react';
import { Button, Link } from '@fluentui/react-components';

import {
  EmptyState,
  FieldGrid,
  FieldTile,
  PageHeader,
  SectionCard,
  SkeletonBlock,
} from '@c3/components/ui';
import { useAmendment } from '@c3/hooks/useAmendment';
import { useNavigate } from '@c3/hooks/useNavigate';

interface AmendmentProfileProps {
  amendmentId: string;
}

const formatDate = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  return value.split('T')[0];
};

export const AmendmentProfile = ({ amendmentId }: AmendmentProfileProps) => {
  const { navigate } = useNavigate();
  const { data: amendment, isLoading, error } = useAmendment(amendmentId);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loadedAt = useMemo(() => new Date().toISOString(), [amendment]);

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
          <SkeletonBlock height="16px" width="240px" />
        </div>
        <SkeletonBlock height="96px" />
        <SkeletonBlock height="200px" />
        <SkeletonBlock height="200px" />
      </div>
    );
  }

  if (error || !amendment) {
    return (
      <div style={{ padding: 'var(--c3-space-8)' }}>
        <EmptyState
          variant="error"
          title="Amendment not found"
          description="This amendment could not be loaded. It may have been removed or you may not have access."
          action={
            <Button
              appearance="primary"
              onClick={() => navigate({ id: 'amendments' })}
            >
              Back to Amendments
            </Button>
          }
        />
      </div>
    );
  }

  const typeName =
    amendment.AmendmentTypeName ?? amendment.AmendmentTypeCode;

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
        title={amendment.AmendmentID}
        subtitle={typeName}
        breadcrumb={[
          {
            label: 'Amendments',
            onClick: () => navigate({ id: 'amendments' }),
          },
        ]}
        actions={
          <Button
            appearance="subtle"
            onClick={() =>
              navigate({
                id: 'contract-profile',
                contractId: String(amendment.ParentContractID),
              })
            }
          >
            Open Parent Contract
          </Button>
        }
        lastUpdated={loadedAt}
      />

      {/* Status hero */}
      <SectionCard title="Status">
        <FieldGrid columns={4}>
          <FieldTile label="Status" value={amendment.Status} />
          <FieldTile
            label="Approval Status"
            value={amendment.ApprovalStatus}
          />
          <FieldTile
            label="Effective Date"
            value={formatDate(amendment.EffectiveDate)}
            mono
          />
          <FieldTile
            label="Parent Contract"
            value={
              amendment.ParentContractCode ?? String(amendment.ParentContractID)
            }
            mono
          />
        </FieldGrid>
      </SectionCard>

      <SectionCard title="Amendment Details">
        <FieldGrid columns={4}>
          <FieldTile label="Amendment ID" value={amendment.AmendmentID} mono />
          <FieldTile
            label="Parent Contract"
            value={
              amendment.ParentContractCode ?? String(amendment.ParentContractID)
            }
            mono
          />
          <FieldTile label="Type" value={typeName} />
          <FieldTile
            label="Effective Date"
            value={formatDate(amendment.EffectiveDate)}
            mono
          />
        </FieldGrid>
      </SectionCard>

      <SectionCard title="Change Summary">
        <FieldGrid columns={3}>
          <FieldTile label="Old Value" value={amendment.OldValue} />
          <FieldTile label="New Value" value={amendment.NewValue} />
          <FieldTile label="Description" value={amendment.Description} />
        </FieldGrid>
      </SectionCard>

      <SectionCard title="Approval Workflow">
        <FieldGrid columns={4}>
          <FieldTile
            label="Approval Status"
            value={amendment.ApprovalStatus}
          />
          <FieldTile
            label="Approval Date"
            value={formatDate(amendment.ApprovalDate)}
            mono
          />
          <FieldTile label="Approved By" value={amendment.ApprovedBy} />
          <FieldTile label="Approval Notes" value={amendment.ApprovalNotes} />
          <FieldTile label="Rejection Note" value={amendment.RejectionNote} />
        </FieldGrid>
      </SectionCard>

      <SectionCard title="Document">
        <FieldGrid columns={2}>
          <FieldTile
            label="Document"
            value={
              amendment.DocumentURL ? (
                <Link href={amendment.DocumentURL} target="_blank" rel="noreferrer">
                  Open Document
                </Link>
              ) : undefined
            }
          />
        </FieldGrid>
      </SectionCard>
    </div>
  );
};
