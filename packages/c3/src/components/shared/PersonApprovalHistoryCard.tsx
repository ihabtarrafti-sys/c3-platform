/**
 * PersonApprovalHistoryCard.tsx
 *
 * Sprint 21 Phase 2 -- Person-scoped approval history / visibility.
 *
 * Renders all C3Approvals for a person, grouped into:
 *   Active / Needs Attention  -- Submitted, InReview, Approved, ExecutionFailed
 *   History                   -- Executed, Rejected
 *
 * Visibility surface only. No approve/reject/execute/recover buttons.
 * ApprovalInbox remains the action/work queue.
 *
 * Payload display uses formatApprovalPayloadSummary -- compact plain-text only.
 * Raw JSON is never rendered.
 *
 * Boundaries:
 *   - No approval mutations.
 *   - No action buttons of any kind.
 *   - No raw payload output.
 *   - Does not modify ApprovalInbox behavior.
 *
 * See: packages/c3/src/hooks/usePersonApprovals.ts
 * See: packages/c3/src/utils/approvalPayloadUtils.ts
 */

import { Badge, Spinner, Text } from '@fluentui/react-components';

import { EmptyState, SectionCard } from '@c3/components/ui';
import { usePersonApprovals } from '@c3/hooks/usePersonApprovals';
import { formatApprovalPayloadSummary } from '@c3/utils/approvalPayloadUtils';
import type { C3Approval } from '@c3/utils/spApprovalMapper';

// ---------------------------------------------------------------------------
// Status grouping
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES  = new Set(['Submitted', 'InReview', 'Approved', 'ExecutionFailed']);
const HISTORY_STATUSES = new Set(['Executed', 'Rejected']);

// ---------------------------------------------------------------------------
// Status badge colors (mirrors ApprovalInbox -- kept consistent)
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, 'warning' | 'informative' | 'brand' | 'success' | 'danger'> = {
  Submitted:       'warning',
  InReview:        'informative',
  Approved:        'brand',
  Rejected:        'danger',
  Executed:        'success',
  ExecutionFailed: 'danger',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateTime(iso: string | undefined): string {
  if (!iso) return '--';
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// ApprovalRow -- single compact approval entry
// ---------------------------------------------------------------------------

const ApprovalRow = ({ approval }: { approval: C3Approval }) => {
  const statusColor = STATUS_COLORS[approval.approvalStatus] ?? 'informative';
  const payloadSummary = formatApprovalPayloadSummary(approval.payload, approval.operationType);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--c3-space-2)',
        padding: 'var(--c3-space-3) var(--c3-space-4)',
        background: 'var(--c3-gray-50)',
        borderRadius: 'var(--c3-radius-md)',
        border: '1px solid var(--c3-gray-100)',
      }}
    >
      {/* Primary row: title + operationType + status badge */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--c3-space-2)',
          flexWrap: 'wrap',
        }}
      >
        <Text
          weight="semibold"
          size={300}
          style={{ color: 'var(--c3-gray-900)', fontVariantNumeric: 'tabular-nums' }}
        >
          {approval.title}
        </Text>
        <Text size={200} style={{ color: 'var(--c3-gray-500)' }}>
          {approval.operationType}
        </Text>
        <Badge appearance="tint" color={statusColor} size="small">
          {approval.approvalStatus}
        </Badge>
      </div>

      {/* Payload summary */}
      {payloadSummary && (
        <Text size={200} style={{ color: 'var(--c3-gray-600)', fontStyle: 'italic' }}>
          {payloadSummary}
        </Text>
      )}

      {/* Audit detail grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 'var(--c3-space-2) var(--c3-space-4)',
        }}
      >
        <AuditField label="Submitted" value={formatDateTime(approval.submittedAt)} />
        <AuditField label="Submitted By" value={approval.submittedBy || '--'} />

        {approval.reason && (
          <AuditField label="Reason" value={approval.reason} wide />
        )}

        {approval.reviewedBy && (
          <AuditField label="Reviewed By" value={approval.reviewedBy} />
        )}
        {approval.reviewedAt && (
          <AuditField label="Reviewed At" value={formatDateTime(approval.reviewedAt)} />
        )}

        {approval.executedAt && (
          <AuditField label="Executed At" value={formatDateTime(approval.executedAt)} />
        )}

        {approval.rejectionReason && (
          <AuditField label="Rejection Reason" value={approval.rejectionReason} wide danger />
        )}
        {approval.executionError && (
          <AuditField label="Execution Error" value={approval.executionError} wide danger />
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// AuditField -- compact label + value cell
// ---------------------------------------------------------------------------

const AuditField = ({
  label,
  value,
  wide,
  danger,
}: {
  label: string;
  value: string;
  wide?: boolean;
  danger?: boolean;
}) => (
  <div style={{ gridColumn: wide ? 'span 2' : undefined }}>
    <Text
      size={100}
      style={{
        color: 'var(--c3-gray-400)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        display: 'block',
        marginBottom: 1,
      }}
    >
      {label}
    </Text>
    <Text
      size={200}
      style={{
        color: danger ? 'var(--c3-critical, #DC2626)' : 'var(--c3-gray-700)',
        wordBreak: 'break-word',
      }}
    >
      {value}
    </Text>
  </div>
);

// ---------------------------------------------------------------------------
// PersonApprovalHistoryCard
// ---------------------------------------------------------------------------

interface PersonApprovalHistoryCardProps {
  personId: string;
}

export const PersonApprovalHistoryCard = ({ personId }: PersonApprovalHistoryCardProps) => {
  const { data: approvals, isLoading, isError } = usePersonApprovals(personId);

  // Loading

  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--c3-space-3)',
          padding: 'var(--c3-space-6)',
        }}
      >
        <Spinner size="small" />
        <Text size={200} style={{ color: 'var(--c3-gray-500)' }}>
          Loading approval history...
        </Text>
      </div>
    );
  }

  // Error

  if (isError) {
    return (
      <SectionCard title="Approval Activity">
        <EmptyState
          compact
          variant="error"
          title="Could not load approval history"
          description="C3Approvals could not be fetched. Verify SP list permissions or try refreshing."
        />
      </SectionCard>
    );
  }

  // Empty (no approvals at all)

  if (approvals.length === 0) {
    return (
      <SectionCard title="Approval Activity">
        <EmptyState
          compact
          title="No approval activity for this person yet."
          description="Journey and credential approvals for this person will appear here."
        />
      </SectionCard>
    );
  }

  // Group by status

  const activeApprovals  = approvals.filter(a => ACTIVE_STATUSES.has(a.approvalStatus));
  const historyApprovals = approvals.filter(a => HISTORY_STATUSES.has(a.approvalStatus));

  // Sort: most recent first within each group
  const bySubmittedDesc = (a: C3Approval, b: C3Approval) => {
    if (!a.submittedAt) return 1;
    if (!b.submittedAt) return -1;
    return b.submittedAt.localeCompare(a.submittedAt);
  };

  const sortedActive  = [...activeApprovals].sort(bySubmittedDesc);
  const sortedHistory = [...historyApprovals].sort(bySubmittedDesc);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-4)' }}>

      {/* Active / Needs Attention */}
      <SectionCard title={`Active / Needs Attention (${sortedActive.length})`}>
        {sortedActive.length === 0 ? (
          <EmptyState
            compact
            title="No pending approval activity for this person."
            description="Active and in-progress approvals will appear here."
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-3)' }}>
            {sortedActive.map(approval => (
              <ApprovalRow key={approval.id} approval={approval} />
            ))}
          </div>
        )}
      </SectionCard>

      {/* History */}
      <SectionCard title={`History (${sortedHistory.length})`}>
        {sortedHistory.length === 0 ? (
          <EmptyState
            compact
            title="No approval history for this person yet."
            description="Executed and rejected approvals will appear here."
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-3)' }}>
            {sortedHistory.map(approval => (
              <ApprovalRow key={approval.id} approval={approval} />
            ))}
          </div>
        )}
      </SectionCard>

    </div>
  );
};
