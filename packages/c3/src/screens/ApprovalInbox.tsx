/**
 * ApprovalInbox.tsx
 *
 * Approval Review + Execution screen for C3 Platform.
 *
 * Sprint 18 Phase 3B: list approvals, Approve/Reject for owners.
 * Sprint 18 Phase 4A: Execute button for Approved approvals (owner only).
 * Sprint 18 Phase 4B: badge distinction Approved vs Executed.
 * Sprint 20 Phase 1 (S20-P1): filter tabs, full audit field display, payload summary.
 *
 * Tab / filter structure (S20-P1):
 *   Pending  = Submitted + InReview   (default — actionable work queue)
 *   Approved = Approved               (awaiting execution)
 *   Executed = Executed               (terminal success)
 *   Rejected = Rejected               (terminal rejection)
 *   Failed   = ExecutionFailed        (terminal failure)
 *   All      = all 6 statuses         (full audit trail)
 *
 * A single listApprovals call fetches all statuses; tabs filter client-side.
 * refetchInterval (30s) remains active — keeps the Pending tab live.
 *
 * Status-to-action matrix (owner) — UNCHANGED from S18:
 *   Submitted / InReview  -> Approve + Reject
 *   Approved              -> Execute
 *   Rejected / Executed / ExecutionFailed -> read-only (no buttons)
 *
 * Self-approval enforcement and owner-only action gating: UNCHANGED.
 *
 * Payload summary (InitiateJourney, S20-P1):
 *   Safe parse — crashes are impossible; malformed JSON yields an
 *   "Invalid payload" label plus a collapsed raw-payload disclosure block.
 */

import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Spinner,
  Tab,
  TabList,
  Text,
  Textarea,
} from '@fluentui/react-components';
import {
  CheckmarkRegular,
  DismissRegular,
  PlayRegular,
} from '@fluentui/react-icons';

import { EmptyState } from '@c3/components/ui';
import { useApp } from '@c3/hooks/useApp';
import { useListApprovals } from '@c3/hooks/useListApprovals';
import { usePatchApprovalStatus, SelfApprovalError } from '@c3/hooks/usePatchApprovalStatus';
import { useExecuteApproval, DuplicateJourneyError, PartialExecutionError, PayloadValidationError } from '@c3/hooks/useExecuteApproval';
import { useToast } from '@c3/hooks/useToast';
import type { C3Approval } from '@c3/utils/spApprovalMapper';

// ---------------------------------------------------------------------------
// Tab configuration
// ---------------------------------------------------------------------------

type InboxTab = 'pending' | 'approved' | 'executed' | 'rejected' | 'failed' | 'all';

/** All 6 lifecycle statuses — fetched in one request, filtered client-side. */
const ALL_STATUSES = [
  'Submitted',
  'InReview',
  'Approved',
  'Rejected',
  'Executed',
  'ExecutionFailed',
] as const;

/** Statuses that belong to each tab. */
const TAB_STATUSES: Record<InboxTab, readonly string[]> = {
  pending:  ['Submitted', 'InReview'],
  approved: ['Approved'],
  executed: ['Executed'],
  rejected: ['Rejected'],
  failed:   ['ExecutionFailed'],
  all:      ALL_STATUSES,
};

/** Tab display labels. */
const TAB_LABELS: Record<InboxTab, string> = {
  pending:  'Pending',
  approved: 'Approved',
  executed: 'Executed',
  rejected: 'Rejected',
  failed:   'Failed',
  all:      'All',
};

/** Ordered tab list for rendering. */
const TAB_ORDER: InboxTab[] = ['pending', 'approved', 'executed', 'rejected', 'failed', 'all'];

/** Empty-state messages per tab. */
const EMPTY_MESSAGES: Record<InboxTab, { title: string; description: string }> = {
  pending:  { title: 'No pending approvals',       description: 'All submissions have been reviewed.' },
  approved: { title: 'No approved approvals',      description: 'No approvals are awaiting execution.' },
  executed: { title: 'No executed approvals',      description: 'No approvals have been executed yet.' },
  rejected: { title: 'No rejected approvals',      description: 'No approvals have been rejected.' },
  failed:   { title: 'No failed executions',       description: 'All executed approvals completed successfully.' },
  all:      { title: 'No approvals found',         description: 'No approvals exist in C3 yet.' },
};

// ---------------------------------------------------------------------------
// Status display helpers
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, 'warning' | 'informative' | 'brand' | 'success' | 'danger'> = {
  Submitted:       'warning',
  InReview:        'informative',
  Approved:        'brand',
  Rejected:        'danger',
  Executed:        'success',
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

// ---------------------------------------------------------------------------
// DetailCell
// ---------------------------------------------------------------------------

const DetailCell = ({
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
        marginBottom: 2,
      }}
    >
      {label}
    </Text>
    <Text
      size={200}
      style={{
        color: danger ? 'var(--c3-critical, #DC2626)' : 'var(--c3-gray-800)',
        wordBreak: 'break-word',
      }}
    >
      {value}
    </Text>
  </div>
);

// ---------------------------------------------------------------------------
// PayloadSummary — safe display of InitiateJourney payload (S20-P1)
//
// Never throws: malformed JSON yields a labelled error + collapsed raw block.
// Only rendered for OperationType === 'InitiateJourney'.
// Does not import approvalPayloads.ts to avoid coupling — accesses fields
// dynamically with type guards.
// ---------------------------------------------------------------------------

const PayloadSummary = ({
  raw,
  operationType,
}: {
  raw: string | undefined;
  operationType: string;
}) => {
  if (operationType !== 'InitiateJourney') return null;

  // ── Missing payload ──────────────────────────────────────────────────────
  if (!raw) {
    return (
      <div
        style={{
          borderTop: '1px solid var(--c3-gray-100)',
          paddingTop: 'var(--c3-space-3)',
        }}
      >
        <Text
          size={100}
          style={{
            color: 'var(--c3-gray-400)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            display: 'block',
            marginBottom: 'var(--c3-space-2)',
          }}
        >
          Journey Payload
        </Text>
        <Text size={200} style={{ color: 'var(--c3-gray-400)', fontStyle: 'italic' }}>
          No payload recorded.
        </Text>
      </div>
    );
  }

  // ── Parse attempt ────────────────────────────────────────────────────────
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // Safe fallback — show labelled error + collapsed raw block.
    return (
      <div
        style={{
          borderTop: '1px solid var(--c3-gray-100)',
          paddingTop: 'var(--c3-space-3)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--c3-space-2)',
        }}
      >
        <Text
          size={100}
          style={{
            color: 'var(--c3-gray-400)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          Journey Payload
        </Text>
        <Text size={200} style={{ color: 'var(--c3-critical, #DC2626)' }}>
          Invalid payload — JSON parse failed.
        </Text>
        <details>
          <summary style={{ fontSize: 11, color: 'var(--c3-gray-400)', cursor: 'pointer' }}>
            Show raw payload
          </summary>
          <pre
            style={{
              fontSize: 11,
              fontFamily: 'monospace',
              color: 'var(--c3-gray-600)',
              background: 'var(--c3-gray-50)',
              border: '1px solid var(--c3-gray-200)',
              borderRadius: 4,
              padding: '8px',
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              marginTop: 4,
            }}
          >
            {raw}
          </pre>
        </details>
      </div>
    );
  }

  // ── Structured display ───────────────────────────────────────────────────
  const journeyType        = typeof parsed['journeyType']        === 'string' ? parsed['journeyType']        : '--';
  const personId           = typeof parsed['personId']           === 'string' ? parsed['personId']           : '--';
  const assignedTo         = typeof parsed['assignedTo']         === 'string' ? parsed['assignedTo']         : null;
  const initiationReason   = typeof parsed['initiationReason']   === 'string' ? parsed['initiationReason']   : null;
  const notes              = typeof parsed['notes']              === 'string' ? parsed['notes']              : null;
  const missionId          = typeof parsed['missionId']          === 'string' ? parsed['missionId']          : null;
  const obligationCount    = Array.isArray(parsed['obligationAssignments'])
    ? (parsed['obligationAssignments'] as unknown[]).length
    : 0;

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
      <Text
        size={100}
        style={{
          color: 'var(--c3-gray-400)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        Journey Payload
      </Text>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: 'var(--c3-space-3)',
        }}
      >
        <DetailCell label="Journey Type" value={journeyType} />
        <DetailCell label="Person ID"    value={personId} />
        <DetailCell
          label="Obligation Assignments"
          value={`${obligationCount} assignment${obligationCount !== 1 ? 's' : ''}`}
        />
        {assignedTo       && <DetailCell label="Assigned To"       value={assignedTo} />}
        {missionId        && <DetailCell label="Mission ID"         value={missionId} />}
        {initiationReason && <DetailCell label="Initiation Reason"  value={initiationReason} wide />}
        {notes            && <DetailCell label="Notes"              value={notes}             wide />}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// ApprovalCard
// ---------------------------------------------------------------------------

interface ApprovalCardProps {
  approval: C3Approval;
  isOwner: boolean;
}

const ApprovalCard = ({ approval, isOwner }: ApprovalCardProps) => {
  const toast = useToast();

  const { mutateAsync: patchAsync, isPending: isPatchPending } = usePatchApprovalStatus();
  const [showReject,   setShowReject]   = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const { mutateAsync: executeAsync, isPending: isExecutePending } = useExecuteApproval();

  const isPending  = isPatchPending || isExecutePending;
  const statusColor = STATUS_COLORS[approval.approvalStatus] ?? 'informative';

  // ── Handlers (UNCHANGED from S18) ─────────────────────────────────────────

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
    let parsedPayload: Record<string, unknown> | null = null;
    try { parsedPayload = JSON.parse(approval.payload ?? ''); } catch { /* handled below */ }
    try {
      await executeAsync(approval);
      const personId = typeof parsedPayload?.['personId'] === 'string'
        ? parsedPayload['personId']
        : approval.targetPersonId ?? 'unknown';
      toast.success(
        'Approval executed',
        `${approval.title} — Journey created for ${personId}.`,
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
      {/* ── Header row ──────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 'var(--c3-space-3)',
        }}
      >
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

      {/* ── Core detail grid ────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 'var(--c3-space-3)',
        }}
      >
        {/* Identity fields — always shown */}
        <DetailCell label="Person ID"    value={approval.targetPersonId ?? '--'} />
        <DetailCell label="Submitted By" value={approval.submittedBy    ?? '--'} />

        {/* Reason — show if present */}
        {approval.reason && (
          <DetailCell label="Reason" value={approval.reason} wide />
        )}

        {/* Review fields — show when the record has been reviewed */}
        {approval.reviewedBy  && <DetailCell label="Reviewed By" value={approval.reviewedBy} />}
        {approval.reviewedAt  && <DetailCell label="Reviewed At" value={formatDateTime(approval.reviewedAt)} />}

        {/* Execution fields — show for terminal execution states */}
        {approval.executedAt  && <DetailCell label="Executed At"     value={formatDateTime(approval.executedAt)} />}
        {approval.executionError && (
          <DetailCell label="Execution Error" value={approval.executionError} wide danger />
        )}

        {/* Rejection reason — show with danger color */}
        {approval.rejectionReason && (
          <DetailCell label="Rejection Reason" value={approval.rejectionReason} wide danger />
        )}
      </div>

      {/* ── Payload summary (S20-P1) — InitiateJourney only ────────────── */}
      <PayloadSummary raw={approval.payload} operationType={approval.operationType} />

      {/* ── Owner action row (UNCHANGED from S18) ───────────────────────── */}
      {isOwner && (() => {
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
                      style={{
                        backgroundColor: 'var(--c3-critical, #DC2626)',
                        color: '#ffffff',
                        border: 'none',
                      }}
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

        // Rejected / Executed / ExecutionFailed: read-only
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

  const [activeTab, setActiveTab] = useState<InboxTab>('pending');

  // Single query for all statuses — tab filtering is client-side.
  // refetchInterval keeps the Pending tab live for real-time review queue.
  const {
    data: allApprovals = [],
    isLoading,
    isError,
    error,
  } = useListApprovals({
    status:          [...ALL_STATUSES],
    refetchInterval: 30_000,
  });

  // ── Per-tab counts for tab labels ─────────────────────────────────────────
  const counts = useMemo(() => ({
    pending:  allApprovals.filter(a => TAB_STATUSES.pending.includes(a.approvalStatus)).length,
    approved: allApprovals.filter(a => TAB_STATUSES.approved.includes(a.approvalStatus)).length,
    executed: allApprovals.filter(a => TAB_STATUSES.executed.includes(a.approvalStatus)).length,
    rejected: allApprovals.filter(a => TAB_STATUSES.rejected.includes(a.approvalStatus)).length,
    failed:   allApprovals.filter(a => TAB_STATUSES.failed.includes(a.approvalStatus)).length,
    all:      allApprovals.length,
  }), [allApprovals]);

  // ── Visible items for the active tab ─────────────────────────────────────
  const visibleApprovals = useMemo(
    () => allApprovals.filter(a => TAB_STATUSES[activeTab].includes(a.approvalStatus)),
    [allApprovals, activeTab],
  );

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 'var(--c3-space-3)',
        }}
      >
        <Spinner size="medium" label="Loading approvals..." />
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div style={{ padding: 'var(--c3-space-8)' }}>
        <EmptyState
          variant="error"
          title="Failed to load approvals"
          description={error instanceof Error ? error.message : 'An unexpected error occurred.'}
        />
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────
  const pendingCount = counts.pending;

  return (
    <div
      style={{
        padding: 'var(--c3-space-7) var(--c3-space-8)',
        maxWidth: 900,
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--c3-space-5)',
      }}
    >
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
        }}
      >
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
              ? 'Review pending submissions, execute approved records, and audit history.'
              : 'Governance approval audit trail and status history.'}
          </Text>
        </div>
        {/* Pending count badge — actionable work indicator */}
        {pendingCount > 0 && (
          <Badge appearance="filled" color="warning" size="large">
            {pendingCount} pending
          </Badge>
        )}
      </div>

      {/* ── Tab bar ──────────────────────────────────────────────────────── */}
      <div
        style={{
          background: 'var(--c3-white)',
          borderRadius: 'var(--c3-radius-md)',
          border: '1px solid var(--c3-gray-200)',
          padding: 'var(--c3-space-1) var(--c3-space-4)',
          boxShadow: 'var(--c3-shadow-1)',
        }}
      >
        <TabList
          selectedValue={activeTab}
          onTabSelect={(_, data) => setActiveTab(data.value as InboxTab)}
        >
          {TAB_ORDER.map(tab => {
            const count = counts[tab];
            const label = TAB_LABELS[tab];
            return (
              <Tab key={tab} value={tab}>
                {count > 0 ? `${label} (${count})` : label}
              </Tab>
            );
          })}
        </TabList>
      </div>

      {/* ── Tab content ──────────────────────────────────────────────────── */}
      {visibleApprovals.length === 0 ? (
        <EmptyState
          variant="empty"
          title={EMPTY_MESSAGES[activeTab].title}
          description={EMPTY_MESSAGES[activeTab].description}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-4)' }}>
          {visibleApprovals.map(approval => (
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
