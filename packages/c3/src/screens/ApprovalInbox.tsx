/**
 * ApprovalInbox.tsx
 *
 * Approval Review + Execution screen for C3 Platform.
 *
 * Sprint 18 Phase 3B: list approvals, Approve/Reject for owners.
 * Sprint 18 Phase 4A: Execute button for Approved approvals (owner only).
 * Sprint 18 Phase 4B: badge distinction Approved vs Executed; PayloadValidationError handling.
 *
 * Status-to-action matrix (owner):
 *   Submitted / InReview  -> Approve + Reject
 *   Approved              -> Execute
 *   Rejected / Executed / ExecutionFailed -> read-only
 *
 * Badge color intent:
 *   Submitted       -> warning  (orange)
 *   InReview        -> informative (blue)
 *   Approved        -> brand    (purple) -- awaiting execution
 *   Executed        -> success  (green)  -- terminal success
 *   Rejected        -> danger   (red)
 *   ExecutionFailed -> danger   (red)
 *
 * Execution sequence: see useExecuteApproval (ADR-013 / Phase 4A).
 * Scope: does NOT execute Submitted, InReview, Rejected, Executed, or ExecutionFailed approvals.
 */

import { useState } from 'react';
import {
  Badge,
  Button,
  Spinner,
  Text,
  Textarea,
} from '@fluentui/react-components';
import {
  CheckmarkRegular,
  DismissRegular,
  PlayRegular,
} from '@fluentui/react-icons';

import { useApp } from '@c3/hooks/useApp';
import { useListApprovals } from '@c3/hooks/useListApprovals';
import { usePatchApprovalStatus, SelfApprovalError } from '@c3/hooks/usePatchApprovalStatus';
import { useExecuteApproval, DuplicateJourneyError, PartialExecutionError, PayloadValidationError } from '@c3/hooks/useExecuteApproval';
import { useToast } from '@c3/hooks/useToast';
import type { C3Approval } from '@c3/utils/spApprovalMapper';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, 'warning' | 'informative' | 'brand' | 'success' | 'danger'> = {
  Submitted:       'warning',
  InReview:        'informative',
  Approved:        'brand',       // distinct from Executed — awaiting execution
  Rejected:        'danger',
  Executed:        'success',     // terminal success state
  ExecutionFailed: 'danger',
};

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

function parsePayload(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// DetailCell
// ---------------------------------------------------------------------------

const DetailCell = ({
  label,
  value,
  wide,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) => (
  <div style={{ gridColumn: wide ? 'span 2' : undefined }}>
    <Text
      size={100}
      style={{
        color: 'var(--c3-gray-400)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        display: 'block',
        marginBottom: 2,
      }}
    >
      {label}
    </Text>
    <Text size={200} style={{ color: 'var(--c3-gray-800)', wordBreak: 'break-all' }}>
      {value}
    </Text>
  </div>
);

// ---------------------------------------------------------------------------
// ApprovalCard
// ---------------------------------------------------------------------------

interface ApprovalCardProps {
  approval: C3Approval;
  isOwner: boolean;
}

const ApprovalCard = ({ approval, isOwner }: ApprovalCardProps) => {
  const toast = useToast();

  // Phase 3B: Approve / Reject
  const { mutateAsync: patchAsync, isPending: isPatchPending } = usePatchApprovalStatus();
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // Phase 4A: Execute
  const { mutateAsync: executeAsync, isPending: isExecutePending } = useExecuteApproval();

  const isPending = isPatchPending || isExecutePending;

  const parsedPayload = parsePayload(approval.payload);
  const statusColor   = STATUS_COLORS[approval.approvalStatus] ?? 'informative';

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleApprove = async () => {
    try {
      await patchAsync({ approval, newStatus: 'Approved' });
      toast.success('Approval approved', `${approval.title} has been approved.`);
    } catch (err) {
      if (err instanceof SelfApprovalError) {
        toast.error('Self-approval not permitted', 'You cannot approve your own submission.');
      } else {
        toast.error('Failed to update approval', 'Please try again or contact support.');
      }
    }
  };

  const handleRejectConfirm = async () => {
    if (!rejectReason.trim()) return;
    try {
      await patchAsync({ approval, newStatus: 'Rejected', rejectionReason: rejectReason.trim() });
      toast.success('Approval rejected', `${approval.title} has been rejected.`);
      setShowReject(false);
      setRejectReason('');
    } catch (err) {
      if (err instanceof SelfApprovalError) {
        toast.error('Self-approval not permitted', 'You cannot reject your own submission.');
      } else {
        toast.error('Failed to update approval', 'Please try again or contact support.');
      }
    }
  };

  const handleExecute = async () => {
    try {
      await executeAsync(approval);
      const personId = typeof parsedPayload?.['personId'] === 'string'
        ? parsedPayload['personId']
        : approval.targetPersonId ?? 'unknown';
      toast.success(
        'Approval executed',
        `${approval.title} -- Journey created for ${personId}.`,
      );
    } catch (err) {
      if (err instanceof DuplicateJourneyError) {
        toast.error(
          'Execution blocked — duplicate journey',
          'An active Onboarding journey already exists for this person. ' +
          'Approval has been marked ExecutionFailed.',
        );
      } else if (err instanceof PayloadValidationError) {
        toast.error(
          'Execution blocked — invalid payload',
          'The approval payload is missing or malformed. No journey was created. ' +
          'Contact support to correct the C3Approvals record.',
        );
      } else if (err instanceof PartialExecutionError) {
        toast.error(
          'Partial execution — manual resolution required',
          'Journey was created but the approval record could not be stamped Executed. ' +
          'Manually update C3Approvals to Executed status.',
        );
      } else {
        const msg = err instanceof Error ? err.message : 'Unknown error.';
        toast.error('Execution failed', msg.slice(0, 200));
      }
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        background: '#FFFFFF',
        border: '1px solid var(--c3-gray-200)',
        borderRadius: 'var(--c3-radius-lg)',
        padding: 'var(--c3-space-5)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--c3-space-4)',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--c3-space-3)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-1)' }}>
          <Text weight="semibold" size={400} style={{ color: 'var(--c3-gray-900)' }}>
            {approval.title}
          </Text>
          <Text size={200} style={{ color: 'var(--c3-gray-500)' }}>
            {approval.operationType} · Submitted {formatDateTime(approval.submittedAt)}
          </Text>
        </div>
        <Badge appearance="tint" color={statusColor} size="medium">
          {approval.approvalStatus}
        </Badge>
      </div>

      {/* Detail grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 'var(--c3-space-3)',
        }}
      >
        <DetailCell label="Person ID"    value={approval.targetPersonId ?? '--'} />
        <DetailCell label="Submitted by" value={approval.submittedBy ?? '--'} />
        {approval.reason && (
          <DetailCell label="Reason" value={approval.reason} wide />
        )}
        {parsedPayload && !!parsedPayload['initiationReason'] && (
          <DetailCell label="Initiation reason" value={String(parsedPayload['initiationReason'])} wide />
        )}
        {parsedPayload && !!parsedPayload['assignedTo'] && (
          <DetailCell label="Assigned to" value={String(parsedPayload['assignedTo'])} />
        )}
        {approval.reviewedBy && (
          <DetailCell label="Reviewed by" value={approval.reviewedBy} />
        )}
        {approval.executedAt && (
          <DetailCell label="Executed at" value={formatDateTime(approval.executedAt)} />
        )}
        {approval.executionError && (
          <DetailCell label="Execution error" value={approval.executionError} wide />
        )}
        {approval.rejectionReason && (
          <DetailCell label="Rejection reason" value={approval.rejectionReason} wide />
        )}
      </div>

      {/* Owner action row */}
      {isOwner && (() => {
        // Submitted / InReview: Approve + Reject
        if (approval.approvalStatus === 'Submitted' || approval.approvalStatus === 'InReview') {
          return (
            <div
              style={{
                borderTop: '1px solid var(--c3-gray-100)',
                paddingTop: 'var(--c3-space-3)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--c3-space-3)',
              }}
            >
              {showReject ? (
                <>
                  <Textarea
                    value={rejectReason}
                    onChange={(_, d) => setRejectReason(d.value)}
                    placeholder="Rejection reason (required)..."
                    rows={3}
                    resize="vertical"
                  />
                  <div style={{ display: 'flex', gap: 'var(--c3-space-2)' }}>
                    <Button
                      appearance="primary"
                      style={{ background: 'var(--c3-error)' }}
                      icon={<DismissRegular />}
                      onClick={() => void handleRejectConfirm()}
                      disabled={isPending || !rejectReason.trim()}
                    >
                      {isPending ? 'Rejecting...' : 'Confirm Reject'}
                    </Button>
                    <Button
                      appearance="secondary"
                      onClick={() => { setShowReject(false); setRejectReason(''); }}
                      disabled={isPending}
                    >
                      Cancel
                    </Button>
                  </div>
                </>
              ) : (
                <div style={{ display: 'flex', gap: 'var(--c3-space-2)' }}>
                  <Button
                    appearance="primary"
                    icon={<CheckmarkRegular />}
                    onClick={() => void handleApprove()}
                    disabled={isPending}
                  >
                    {isPending ? 'Approving...' : 'Approve'}
                  </Button>
                  <Button
                    appearance="secondary"
                    icon={<DismissRegular />}
                    onClick={() => setShowReject(true)}
                    disabled={isPending}
                  >
                    Reject
                  </Button>
                </div>
              )}
            </div>
          );
        }

        // Approved: Execute
        if (approval.approvalStatus === 'Approved') {
          return (
            <div
              style={{
                borderTop: '1px solid var(--c3-gray-100)',
                paddingTop: 'var(--c3-space-3)',
              }}
            >
              <Button
                appearance="primary"
                icon={<PlayRegular />}
                onClick={() => void handleExecute()}
                disabled={isExecutePending}
              >
                {isExecutePending ? 'Executing...' : 'Execute'}
              </Button>
            </div>
          );
        }

        // Rejected / Executed / ExecutionFailed: read-only (no buttons)
        return null;
      })()}
    </div>
  );
};

// ---------------------------------------------------------------------------
// ApprovalInbox
// ---------------------------------------------------------------------------

export const ApprovalInbox = () => {
  const { currentUser } = useApp();
  const isOwner = currentUser.c3Role === 'owner';

  // Fetch Submitted, InReview, and Approved -- all statuses that may need action.
  const { data: approvals, isLoading, isError, error } = useListApprovals({
    status: ['Submitted', 'InReview', 'Approved'],
  });

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 'var(--c3-space-3)' }}>
        <Spinner size="medium" label="Loading approvals..." />
      </div>
    );
  }

  if (isError) {
    return (
      <div style={{ padding: 'var(--c3-space-8)', maxWidth: 600 }}>
        <Text size={400} weight="semibold" style={{ color: 'var(--c3-error)', display: 'block' }}>
          Failed to load approvals
        </Text>
        <Text size={200} style={{ color: 'var(--c3-gray-500)', display: 'block', marginTop: 'var(--c3-space-2)' }}>
          {error instanceof Error ? error.message : 'An unexpected error occurred.'}
        </Text>
      </div>
    );
  }

  const items: C3Approval[] = approvals ?? [];

  return (
    <div
      style={{
        padding: 'var(--c3-space-7) var(--c3-space-8)',
        maxWidth: 900,
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--c3-space-6)',
      }}
    >
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div>
          <Text
            as="h1"
            size={700}
            weight="semibold"
            style={{ color: 'var(--c3-gray-900)', display: 'block' }}
          >
            Approvals
          </Text>
          <Text size={200} style={{ color: 'var(--c3-gray-500)', display: 'block', marginTop: 'var(--c3-space-1)' }}>
            {isOwner
              ? 'Review pending submissions and execute approved records.'
              : 'Approval requests awaiting owner review.'}
          </Text>
        </div>
        {items.length > 0 && (
          <Badge appearance="filled" color="warning" size="large">
            {items.length}
          </Badge>
        )}
      </div>

      {/* Empty state */}
      {items.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: 'var(--c3-space-10) var(--c3-space-6)',
            border: '1px dashed var(--c3-gray-300)',
            borderRadius: 'var(--c3-radius-lg)',
          }}
        >
          <Text size={400} weight="semibold" style={{ color: 'var(--c3-gray-600)', display: 'block' }}>
            All clear
          </Text>
          <Text size={200} style={{ color: 'var(--c3-gray-400)', display: 'block', marginTop: 'var(--c3-space-2)' }}>
            No pending approvals at this time.
          </Text>
        </div>
      )}

      {/* Approval cards */}
      {items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-4)' }}>
          {items.map(approval => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              isOwner={isOwner}
            />
          ))}
        </div>
      )}
    </div>
  );
};
