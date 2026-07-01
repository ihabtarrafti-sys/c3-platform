/**
 * ApprovalInbox.tsx
 *
 * Approval Review + Execution screen for C3 Platform.
 *
 * Sprint 18 Phase 3B: list approvals, Approve/Reject for owners.
 * Sprint 18 Phase 4A: Execute button for Approved approvals (owner only).
 * Sprint 18 Phase 4B: badge distinction Approved vs Executed.
 * Sprint 20 Phase 1 (S20-P1): filter tabs, full audit field display, payload summary.
 * Sprint 20 Phase 2 (S20-P2): Recover Execution Stamp action for partial execution failures.
 * Sprint 20 Phase 3 (S20-P3): AddCredential payload summary; PartialCredentialExecutionError handling.
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
 *   Approved              -> Execute  OR  Recover Execution Stamp (S20-P2)
 *   Rejected / Executed / ExecutionFailed -> read-only (no buttons)
 *
 * Self-approval enforcement and owner-only action gating: UNCHANGED.
 *
 * Recovery detection (S20-P2):
 *   For each Approved + InitiateJourney card, a lazy useActiveJourney query
 *   checks whether an active Onboarding journey already exists for the payload
 *   personId. If so, the Execute button is replaced by Recover Execution Stamp.
 *   Recovery stamps the approval Executed without creating a new journey.
 *   Non-owner view remains read-only regardless.
 *
 * Payload summary (S20-P1 + S20-P3):
 *   InitiateJourney: journeyType, personId, assignedTo, initiationReason, notes,
 *                    missionId, obligationAssignments count.
 *   AddCredential:   credentialType, referenceNumber, holderPersonId, issuedBy,
 *                    issuedDate, expiryDate, notes, subType, validFromDate,
 *                    supersedesCredentialId.
 *   Unknown operationType: raw JSON disclosure block.
 *   All parsing is safe — malformed JSON yields "Invalid payload" label + collapsed raw block.
 */

import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  MessageBar,
  MessageBarBody,
  Spinner,
  Tab,
  TabList,
  Text,
  Textarea,
} from '@fluentui/react-components';
import {
  ArrowRepeatAllRegular,
  CheckmarkRegular,
  DismissRegular,
  PlayRegular,
} from '@fluentui/react-icons';

import { EmptyState } from '@c3/components/ui';
import { useActiveJourney } from '@c3/hooks/useActiveJourney';
import { useApp } from '@c3/hooks/useApp';
import { useListApprovals } from '@c3/hooks/useListApprovals';
import { usePatchApprovalStatus, SelfApprovalError } from '@c3/hooks/usePatchApprovalStatus';
import {
  useExecuteApproval,
  DuplicateJourneyError,
  PartialExecutionError,
  PartialCredentialExecutionError,
  PayloadValidationError,
} from '@c3/hooks/useExecuteApproval';
import { useRecoverExecutionStamp, RecoveryTargetMissingError } from '@c3/hooks/useRecoverExecutionStamp';
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
// Safe personId extraction (no import coupling to payload types)
// ---------------------------------------------------------------------------

function extractPayloadPersonId(raw: string | undefined): string {
  if (!raw || !raw.trim()) return '';
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const id = parsed['personId'];
    return typeof id === 'string' ? id.trim() : '';
  } catch {
    return '';
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
// PayloadSummary — safe display of typed approval payloads (S20-P1 + S20-P3)
//
// Never throws: malformed JSON yields a labelled error + collapsed raw block.
// Renders for InitiateJourney and AddCredential; unknown types show raw block.
// ---------------------------------------------------------------------------

const PayloadSummary = ({
  raw,
  operationType,
}: {
  raw: string | undefined;
  operationType: string;
}) => {
  // Only render for known operation types with defined payload shapes
  if (operationType !== 'InitiateJourney' && operationType !== 'AddCredential') return null;

  const sectionLabel =
    operationType === 'AddCredential' ? 'Credential Payload' : 'Journey Payload';

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
          {sectionLabel}
        </Text>
        <Text size={200} style={{ color: 'var(--c3-gray-400)', fontStyle: 'italic' }}>
          No payload recorded.
        </Text>
      </div>
    );
  }

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
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
          {sectionLabel}
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

  // ── InitiateJourney payload fields ──────────────────────────────────────
  if (operationType === 'InitiateJourney') {
    const journeyType      = typeof parsed['journeyType']      === 'string' ? parsed['journeyType']      : '--';
    const personId         = typeof parsed['personId']         === 'string' ? parsed['personId']         : '--';
    const assignedTo       = typeof parsed['assignedTo']       === 'string' ? parsed['assignedTo']       : null;
    const initiationReason = typeof parsed['initiationReason'] === 'string' ? parsed['initiationReason'] : null;
    const notes            = typeof parsed['notes']            === 'string' ? parsed['notes']            : null;
    const missionId        = typeof parsed['missionId']        === 'string' ? parsed['missionId']        : null;
    const obligationCount  = Array.isArray(parsed['obligationAssignments'])
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
          {assignedTo       && <DetailCell label="Assigned To"      value={assignedTo} />}
          {missionId        && <DetailCell label="Mission ID"        value={missionId} />}
          {initiationReason && <DetailCell label="Initiation Reason" value={initiationReason} wide />}
          {notes            && <DetailCell label="Notes"             value={notes}             wide />}
        </div>
      </div>
    );
  }

  // ── AddCredential payload fields (S20-P3) ───────────────────────────────
  const credentialType         = typeof parsed['credentialType']         === 'string' ? parsed['credentialType']         : '--';
  const referenceNumber        = typeof parsed['referenceNumber']        === 'string' ? parsed['referenceNumber']        : '--';
  const holderPersonId         = typeof parsed['holderPersonId']         === 'string' ? parsed['holderPersonId']         : '--';
  const issuedBy               = typeof parsed['issuedBy']               === 'string' ? parsed['issuedBy']               : null;
  const issuedDate             = typeof parsed['issuedDate']             === 'string' ? parsed['issuedDate']             : null;
  const expiryDate             = typeof parsed['expiryDate']             === 'string' ? parsed['expiryDate']             : null;
  const credNotes              = typeof parsed['notes']                  === 'string' ? parsed['notes']                  : null;
  const subType                = typeof parsed['subType']                === 'string' ? parsed['subType']                : null;
  const validFromDate          = typeof parsed['validFromDate']          === 'string' ? parsed['validFromDate']          : null;
  const supersedesCredentialId = typeof parsed['supersedesCredentialId'] === 'string' ? parsed['supersedesCredentialId'] : null;

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
        Credential Payload
      </Text>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: 'var(--c3-space-3)',
        }}
      >
        <DetailCell label="Credential Type"   value={credentialType} />
        <DetailCell label="Reference Number"  value={referenceNumber} />
        <DetailCell label="Holder Person ID"  value={holderPersonId} />
        {issuedBy               && <DetailCell label="Issued By"               value={issuedBy} />}
        {issuedDate             && <DetailCell label="Issue Date"               value={issuedDate} />}
        {expiryDate             && <DetailCell label="Expiry Date"              value={expiryDate} />}
        {validFromDate          && <DetailCell label="Valid From"               value={validFromDate} />}
        {subType                && <DetailCell label="Sub-Type"                 value={subType} />}
        {supersedesCredentialId && <DetailCell label="Supersedes Credential"   value={supersedesCredentialId} />}
        {credNotes              && <DetailCell label="Notes"                    value={credNotes} wide />}
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
  const { mutateAsync: recoverAsync, isPending: isRecoverPending  } = useRecoverExecutionStamp();

  // ── Recovery candidate detection (S20-P2) ─────────────────────────────────
  //
  // A recovery candidate is an Approved + InitiateJourney approval whose
  // payload contains a parseable personId. Only for these do we fire a
  // useActiveJourney query. The `enabled` param suppresses the query for all
  // other cards (Submitted / InReview / Rejected / Executed / ExecutionFailed,
  // Approved AddCredential cards, or missing personId).
  //
  // AddCredential approvals in Approved state use the normal Execute button —
  // no recovery UX is implemented for credentials in Phase 3 (known gap, TD-13 residual).

  const payloadPersonId = useMemo(
    () => extractPayloadPersonId(approval.payload),
    [approval.payload],
  );

  const isRecoveryCandidate =
    approval.approvalStatus === 'Approved' &&
    approval.operationType  === 'InitiateJourney' &&
    payloadPersonId.length  > 0;

  const {
    data: existingJourney,
    isLoading: isJourneyChecking,
  } = useActiveJourney(payloadPersonId, 'Onboarding', isRecoveryCandidate);

  // True only once the query has settled and returned a journey
  const isPartialExecutionRecovery = isRecoveryCandidate && existingJourney != null;

  const isPending = isPatchPending || isExecutePending || isRecoverPending;
  const statusColor = STATUS_COLORS[approval.approvalStatus] ?? 'informative';

  // ── Action handlers (UNCHANGED from S18/S20-P1/P2 except AddCredential toast) ──

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
    try { parsedPayload = JSON.parse(approval.payload ?? '') as Record<string, unknown>; } catch { /* handled below */ }

    try {
      await executeAsync(approval);

      // Build a contextual success message based on operationType
      const opType = parsedPayload?.['operationType'];
      if (opType === 'AddCredential') {
        const holderPersonId = typeof parsedPayload?.['holderPersonId'] === 'string'
          ? parsedPayload['holderPersonId']
          : approval.targetPersonId ?? 'unknown';
        const credType = typeof parsedPayload?.['credentialType'] === 'string'
          ? parsedPayload['credentialType']
          : '';
        toast.success(
          'Approval executed',
          `${approval.title} — ${credType} credential registered for ${holderPersonId}.`,
        );
      } else {
        // InitiateJourney or other (default)
        const personId = typeof parsedPayload?.['personId'] === 'string'
          ? parsedPayload['personId']
          : approval.targetPersonId ?? 'unknown';
        toast.success(
          'Approval executed',
          `${approval.title} — Journey created for ${personId}.`,
        );
      }
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
          'The approval payload is missing or malformed. No record was created. ' +
          'Contact support to correct the C3Approvals record.',
        );
      } else if (err instanceof PartialExecutionError) {
        toast.error(
          'Partial execution — manual resolution required',
          'Journey was created but the approval record could not be stamped Executed. ' +
          'Manually update C3Approvals to Executed status.',
        );
      } else if (err instanceof PartialCredentialExecutionError) {
        toast.error(
          'Partial execution — manual resolution required',
          'Credential was registered but the approval record could not be stamped Executed. ' +
          'Manually update C3Approvals to Executed status.',
        );
      } else {
        const msg = err instanceof Error ? err.message : 'Unknown error.';
        toast.error('Execution failed', msg.slice(0, 200));
      }
    }
  };

  const handleRecover = async () => {
    try {
      await recoverAsync(approval);
      toast.success(
        'Execution stamp recovered',
        `${approval.title} marked Executed. Existing journey for ${payloadPersonId} was preserved.`,
      );
    } catch (err) {
      if (err instanceof RecoveryTargetMissingError) {
        toast.error(
          'Recovery failed — no active journey found',
          `No active Onboarding journey was found for ${payloadPersonId}. ` +
          'Use the Execute button to create one.',
        );
      } else {
        toast.error(
          'Recovery failed',
          'Please retry or contact support.',
        );
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
        <DetailCell label="Person ID"    value={approval.targetPersonId ?? '--'} />
        <DetailCell label="Submitted By" value={approval.submittedBy    ?? '--'} />

        {approval.reason && (
          <DetailCell label="Reason" value={approval.reason} wide />
        )}

        {approval.reviewedBy  && <DetailCell label="Reviewed By" value={approval.reviewedBy} />}
        {approval.reviewedAt  && <DetailCell label="Reviewed At" value={formatDateTime(approval.reviewedAt)} />}

        {approval.executedAt  && <DetailCell label="Executed At"     value={formatDateTime(approval.executedAt)} />}
        {approval.executionError && (
          <DetailCell label="Execution Error" value={approval.executionError} wide danger />
        )}

        {approval.rejectionReason && (
          <DetailCell label="Rejection Reason" value={approval.rejectionReason} wide danger />
        )}
      </div>

      {/* ── Payload summary (S20-P1 + S20-P3) ──────────────────────────── */}
      <PayloadSummary raw={approval.payload} operationType={approval.operationType} />

      {/* ── Owner action row ────────────────────────────────────────────── */}
      {isOwner && (() => {

        // ── Submitted / InReview: Approve + Reject (UNCHANGED) ───────────
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

        // ── Approved: Execute OR Recover (S20-P2, unchanged for InitiateJourney) ──
        // AddCredential approvals show the normal Execute button — no recovery
        // UX for credentials in Phase 3 (isRecoveryCandidate is false for AddCredential).
        if (approval.approvalStatus === 'Approved') {
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
              {/* Journey existence check is in-flight for recovery candidates */}
              {isJourneyChecking ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--c3-space-2)' }}>
                  <Spinner size="extra-tiny" />
                  <Text size={200} style={{ color: 'var(--c3-gray-400)' }}>Checking...</Text>
                </div>
              ) : isPartialExecutionRecovery ? (
                /* ── Partial execution recovery path (InitiateJourney only) ─ */
                <>
                  <MessageBar intent="warning">
                    <MessageBarBody>
                      <Text size={200}>
                        An active Onboarding journey already exists for{' '}
                        <strong>{payloadPersonId}</strong>. This may be a partial execution
                        failure. <strong>Recover</strong> will stamp this approval as Executed
                        without creating a new journey.
                      </Text>
                    </MessageBarBody>
                  </MessageBar>
                  <Button
                    appearance="primary"
                    style={{
                      backgroundColor: 'var(--colorPaletteMarigoldBackground3, #835B00)',
                      color: '#ffffff',
                      border: 'none',
                    }}
                    icon={<ArrowRepeatAllRegular />}
                    onClick={() => void handleRecover()}
                    disabled={isRecoverPending}
                  >
                    {isRecoverPending ? 'Recovering...' : 'Recover Execution Stamp'}
                  </Button>
                </>
              ) : (
                /* ── Normal Execute path (UNCHANGED, also used for AddCredential) ─ */
                <Button
                  appearance="primary"
                  icon={<PlayRegular />}
                  onClick={() => void handleExecute()}
                  disabled={isExecutePending}
                >
                  {isExecutePending ? 'Executing...' : 'Execute'}
                </Button>
              )}
            </div>
          );
        }

        // ── Rejected / Executed / ExecutionFailed: read-only ──────────────
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
