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
 * Sprint 21 Phase 1 (S21-P1): AddCredential partial execution recovery UX (credential stamp-only path).
 * Sprint 23 Phase 1 (S23-P1): DeactivateCredential payload summary and partial execution recovery UX.
 * Sprint 25 (S25):            AddPerson payload summary; PartialAddPersonExecutionError handling.
 *
 * Tab / filter structure (S20-P1):
 *   Pending  = Submitted + InReview   (default -- actionable work queue)
 *   Approved = Approved               (awaiting execution)
 *   Executed = Executed               (terminal success)
 *   Rejected = Rejected               (terminal rejection)
 *   Failed   = ExecutionFailed        (terminal failure)
 *   All      = all 6 statuses         (full audit trail)
 *
 * A single listApprovals call fetches all statuses; tabs filter client-side.
 * refetchInterval (30s) remains active -- keeps the Pending tab live.
 *
 * Status-to-action matrix (owner) -- UNCHANGED from S18:
 *   Submitted / InReview  -> Approve + Reject
 *   Approved              -> Execute  OR  Recover Execution Stamp (S20-P2 / S21-P1)
 *   Rejected / Executed / ExecutionFailed -> read-only (no buttons)
 *
 * Self-approval enforcement and owner-only action gating: UNCHANGED.
 *
 * Recovery detection (S20-P2 -- InitiateJourney):
 *   For each Approved + InitiateJourney card, a lazy useActiveJourney query
 *   checks whether an active Onboarding journey already exists for the payload
 *   personId. If so, the Execute button is replaced by Recover Execution Stamp.
 *   Recovery stamps the approval Executed without creating a new journey.
 *   Non-owner view remains read-only regardless.
 *
 * Credential recovery detection (S21-P1 -- AddCredential):
 *   For each Approved + AddCredential card, a lazy usePersonCredentials query
 *   checks whether a credential matching credentialType + referenceNumber already
 *   exists for holderPersonId. If so, the Execute button is replaced by Recover
 *   Execution Stamp. Recovery stamps the approval Executed without creating a new
 *   credential. Prevents duplicate CRED-XXXX rows on re-execution.
 *
 * Deactivation recovery detection (S23-P1 -- DeactivateCredential):
 *   For each Approved + DeactivateCredential card, a lazy useGetCredential query
 *   checks whether the target credential already has IsActive = false. If so, the
 *   Execute button is replaced by Recover Execution Stamp. Recovery stamps the
 *   approval Executed without re-applying the deactivation MERGE.
 *   Prevents double-MERGE on a credential already inactive.
 *
 * Payload summary (S20-P1 + S20-P3 + S23-P1):
 *   InitiateJourney:      journeyType, personId, assignedTo, initiationReason, notes,
 *                         missionId, obligationAssignments count.
 *   AddCredential:        credentialType, referenceNumber, holderPersonId, issuedBy,
 *                         issuedDate, expiryDate, notes, subType, validFromDate,
 *                         supersedesCredentialId.
 *   DeactivateCredential: credentialId, holderPersonId, credentialType, referenceNumber,
 *                         reason, requestedBy.
 *   AddPerson:            fullName, ign, primaryRole, nationality, currentTeam,
 *                         currentGameTitle, primaryDepartment, personnelCode,
 *                         requestedBy, notes.
 *   Unknown operationType: raw JSON disclosure block.
 *   All parsing is safe -- malformed JSON yields "Invalid payload" label + collapsed raw block.
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
import { useActionableApprovals } from '@c3/hooks/useActionableApprovals';
import { useActiveJourney } from '@c3/hooks/useActiveJourney';
import { useApp } from '@c3/hooks/useApp';
import { useTerminalApprovals, DEFAULT_TERMINAL_HISTORY_LIMIT } from '@c3/hooks/useTerminalApprovals';
import { usePatchApprovalStatus, SelfApprovalError } from '@c3/hooks/usePatchApprovalStatus';
import {
  useExecuteApproval,
  DuplicateJourneyError,
  PartialExecutionError,
  PartialCredentialExecutionError,
  PartialDeactivationExecutionError,
  PartialAddPersonExecutionError,
  PartialParticipantAddExecutionError,
  PartialParticipantRemovalExecutionError,
  CredentialAlreadyInactiveError,
  PayloadValidationError,
} from '@c3/hooks/useExecuteApproval';
import {
  ActiveKitDependencyError,
  ParticipantConflictError,
} from '@c3/services/errors';
import { usePeople } from '@c3/hooks/usePeople';
import { useGetCredential } from '@c3/hooks/useGetCredential';
import { usePersonCredentials } from '@c3/hooks/usePersonCredentials';
import {
  useRecoverCredentialExecutionStamp,
  CredentialRecoveryTargetMissingError,
} from '@c3/hooks/useRecoverCredentialExecutionStamp';
import {
  useRecoverDeactivationExecutionStamp,
  DeactivationRecoveryTargetMissingError,
  DeactivationRecoveryTargetActiveError,
} from '@c3/hooks/useRecoverDeactivationExecutionStamp';
import { useRecoverExecutionStamp, RecoveryTargetMissingError } from '@c3/hooks/useRecoverExecutionStamp';
import { useToast } from '@c3/hooks/useToast';
import type { CredentialType } from '@c3/types';
import {
  buildApprovalInboxView,
  visibleApprovalsForTab,
} from '@c3/utils/approvalInboxView';
import { CREDENTIAL_TYPE_LABELS } from '@c3/utils/credentialLabels';
import type { C3Approval } from '@c3/utils/spApprovalMapper';

// ---------------------------------------------------------------------------
// Tab configuration
// ---------------------------------------------------------------------------

type InboxTab = 'pending' | 'approved' | 'executed' | 'rejected' | 'failed' | 'all';

/**
 * S31 data model (Approval Query Integrity):
 *   - actionable query (COMPLETE, exhaustively paged): Submitted, InReview,
 *     Approved, ExecutionFailed — every actionable approval is ALWAYS visible,
 *     regardless of age; ExecutionFailed recovery affordances never age out.
 *   - terminal query (WINDOWED): the latest N Executed/Rejected rows by Id.
 *     Tab labels and copy present the window truthfully — loaded counts are
 *     never shown as authoritative totals once the window saturates.
 *
 * Failure semantics AND tab status sets live in the PURE module
 * utils/approvalInboxView.ts (parity-tested): actionable failure ⇒ explicit
 * error state, never an empty success; terminal failure alone ⇒ actionable
 * data stays fully visible and terminal tabs render as UNAVAILABLE (null),
 * never as zero history.
 */

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
// Safe credential recovery field extraction (S21-P1)
// ---------------------------------------------------------------------------

interface CredentialRecoveryFields {
  holderPersonId: string;
  credentialType: string;
  referenceNumber: string;
}

function extractCredentialRecoveryFields(raw: string | undefined): CredentialRecoveryFields | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const holderPersonId  = parsed['holderPersonId'];
    const credentialType  = parsed['credentialType'];
    const referenceNumber = parsed['referenceNumber'];
    if (
      typeof holderPersonId  === 'string' && holderPersonId.trim().length  > 0 &&
      typeof credentialType  === 'string' && credentialType.trim().length  > 0 &&
      typeof referenceNumber === 'string' && referenceNumber.trim().length > 0
    ) {
      return {
        holderPersonId:  holderPersonId.trim(),
        credentialType:  credentialType.trim(),
        referenceNumber: referenceNumber.trim(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Safe deactivation recovery field extraction (S23-P1)
// ---------------------------------------------------------------------------

interface DeactivationRecoveryFieldsInbox {
  credentialId: string;
  holderPersonId: string;
}

function extractDeactivationRecoveryFields(raw: string | undefined): DeactivationRecoveryFieldsInbox | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const credentialId   = parsed['credentialId'];
    const holderPersonId = parsed['holderPersonId'];
    if (
      typeof credentialId   === 'string' && credentialId.trim().length   > 0 &&
      typeof holderPersonId === 'string' && holderPersonId.trim().length > 0
    ) {
      return {
        credentialId:   credentialId.trim(),
        holderPersonId: holderPersonId.trim(),
      };
    }
    return null;
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
// PayloadSummary -- safe display of typed approval payloads (S20-P1 + S20-P3)
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
  // Person name resolution (S29B) — cached shared query; safe ID fallback.
  // Called unconditionally (rules of hooks) before the operation-type gate.
  const { data: summaryPeople = [] } = usePeople();

  // Only render for known operation types with defined payload shapes
  if (
    operationType !== 'InitiateJourney' &&
    operationType !== 'AddCredential' &&
    operationType !== 'DeactivateCredential' &&
    operationType !== 'AddPerson' &&
    operationType !== 'AddMissionParticipant' &&
    operationType !== 'RemoveMissionParticipant'
  ) return null;

  const personLabel = (personId: string): string => {
    const person = summaryPeople.find(p => p.PersonID === personId);
    return person ? `${person.FullName} (${personId})` : personId;
  };

  const sectionLabel =
    operationType === 'AddCredential'            ? 'Credential Payload' :
    operationType === 'DeactivateCredential'     ? 'Deactivation Payload' :
    operationType === 'AddPerson'                ? 'Person Payload' :
    operationType === 'AddMissionParticipant'    ? 'Participant Addition' :
    operationType === 'RemoveMissionParticipant' ? 'Participant Removal' :
    'Journey Payload';

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
          Invalid payload -- JSON parse failed.
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

  // -- InitiateJourney payload fields --
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

  // -- DeactivateCredential payload fields (S23-P1) --
  if (operationType === 'DeactivateCredential') {
    const credentialId   = typeof parsed['credentialId']    === 'string' ? parsed['credentialId']    : '--';
    const holderPersonId = typeof parsed['holderPersonId']  === 'string' ? parsed['holderPersonId']  : '--';
    const credTypeRaw    = typeof parsed['credentialType']  === 'string' ? parsed['credentialType']  : null;
    const credTypeLabel  = credTypeRaw
      ? (CREDENTIAL_TYPE_LABELS[credTypeRaw as CredentialType] ?? credTypeRaw)
      : '--';
    const referenceNumber = typeof parsed['referenceNumber'] === 'string' ? parsed['referenceNumber'] : '--';
    const reason          = typeof parsed['reason']          === 'string' ? parsed['reason']          : null;
    const requestedBy     = typeof parsed['requestedBy']     === 'string' ? parsed['requestedBy']     : null;

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
          Deactivation Payload
        </Text>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 'var(--c3-space-3)',
          }}
        >
          <DetailCell label="Credential ID"    value={credentialId} />
          <DetailCell label="Holder Person ID" value={holderPersonId} />
          <DetailCell label="Credential Type"  value={credTypeLabel} />
          <DetailCell label="Reference Number" value={referenceNumber} />
          {requestedBy && <DetailCell label="Requested By" value={requestedBy} />}
          {reason      && <DetailCell label="Reason"       value={reason} wide />}
        </div>
      </div>
    );
  }

  // -- AddMissionParticipant / RemoveMissionParticipant payload fields (S29B) --
  if (operationType === 'AddMissionParticipant' || operationType === 'RemoveMissionParticipant') {
    const missionId = typeof parsed['missionId'] === 'string' ? parsed['missionId'] : '--';
    const personId  = typeof parsed['personId']  === 'string' ? parsed['personId']  : '--';
    const reason    = typeof parsed['reason']    === 'string' ? parsed['reason']    : null;

    const isAdd        = operationType === 'AddMissionParticipant';
    const role         = isAdd && typeof parsed['role'] === 'string' ? parsed['role'] : null;
    const externalCode = isAdd && typeof parsed['externalCode'] === 'string' ? parsed['externalCode'] : null;
    const perDiemRate  = isAdd && typeof parsed['perDiemRate'] === 'number' ? parsed['perDiemRate'] : null;

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
          style={{ color: 'var(--c3-gray-400)', textTransform: 'uppercase', letterSpacing: '0.06em' }}
        >
          {sectionLabel}
        </Text>
        <Text size={300} style={{ color: 'var(--c3-gray-950)' }}>
          {isAdd
            ? <>Add <strong>{personLabel(personId)}</strong> to <strong>{missionId}</strong>
                {role ? ` as ${role}` : ''}
                {externalCode ? ` · External ${externalCode}` : ''}
                {perDiemRate !== null ? ` · Per diem ${perDiemRate}` : ''}</>
            : <>Remove <strong>{personLabel(personId)}</strong> from <strong>{missionId}</strong>
                {reason ? ` · Reason: ${reason}` : ''}</>}
        </Text>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 'var(--c3-space-3)',
          }}
        >
          <DetailCell label="Mission ID" value={missionId} />
          <DetailCell label="Person ID"  value={personId} />
          {role         && <DetailCell label="Role"          value={role} />}
          {externalCode && <DetailCell label="External Code" value={externalCode} />}
          {perDiemRate !== null && <DetailCell label="Per Diem" value={String(perDiemRate)} />}
          {reason       && <DetailCell label="Reason"        value={reason} wide />}
        </div>
      </div>
    );
  }

  // -- AddPerson payload fields (S25) --
  if (operationType === 'AddPerson') {
    const fullName          = typeof parsed['fullName']          === 'string' ? parsed['fullName']          : '--';
    const ign               = typeof parsed['ign']               === 'string' ? parsed['ign']               : null;
    const primaryRole       = typeof parsed['primaryRole']       === 'string' ? parsed['primaryRole']       : null;
    const nationality       = typeof parsed['nationality']       === 'string' ? parsed['nationality']       : null;
    const currentTeam       = typeof parsed['currentTeam']       === 'string' ? parsed['currentTeam']       : null;
    const currentGameTitle  = typeof parsed['currentGameTitle']  === 'string' ? parsed['currentGameTitle']  : null;
    const primaryDepartment = typeof parsed['primaryDepartment'] === 'string' ? parsed['primaryDepartment'] : null;
    const personnelCode     = typeof parsed['personnelCode']     === 'string' ? parsed['personnelCode']     : null;
    const requestedBy       = typeof parsed['requestedBy']       === 'string' ? parsed['requestedBy']       : null;
    const personNotes       = typeof parsed['notes']             === 'string' ? parsed['notes']             : null;

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
          Person Payload
        </Text>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 'var(--c3-space-3)',
          }}
        >
          <DetailCell label="Full Name"          value={fullName} />
          {ign               && <DetailCell label="IGN / Alias"       value={ign} />}
          {primaryRole       && <DetailCell label="Primary Role"      value={primaryRole} />}
          {nationality       && <DetailCell label="Nationality"       value={nationality} />}
          {currentTeam       && <DetailCell label="Current Team"      value={currentTeam} />}
          {currentGameTitle  && <DetailCell label="Game Title"        value={currentGameTitle} />}
          {primaryDepartment && <DetailCell label="Department"        value={primaryDepartment} />}
          {personnelCode     && <DetailCell label="Personnel Code"    value={personnelCode} />}
          {requestedBy       && <DetailCell label="Requested By"      value={requestedBy} />}
          {personNotes       && <DetailCell label="Notes"             value={personNotes} wide />}
        </div>
      </div>
    );
  }

  // -- AddCredential payload fields (S20-P3) --
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

  const { mutateAsync: executeAsync,           isPending: isExecutePending           } = useExecuteApproval();
  const { mutateAsync: recoverAsync,           isPending: isRecoverPending           } = useRecoverExecutionStamp();
  const { mutateAsync: recoverCredentialAsync, isPending: isRecoverCredentialPending } = useRecoverCredentialExecutionStamp();
  const { mutateAsync: recoverDeactivationAsync, isPending: isRecoverDeactivationPending } = useRecoverDeactivationExecutionStamp();

  // -- Recovery candidate detection (S20-P2: InitiateJourney) --
  //
  // A recovery candidate is an Approved + InitiateJourney approval whose
  // payload contains a parseable personId. Only for these do we fire a
  // useActiveJourney query. The `enabled` param suppresses the query for all
  // other cards (Submitted / InReview / Rejected / Executed / ExecutionFailed,
  // Approved AddCredential cards, or missing personId).

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

  // -- Credential recovery candidate detection (S21-P1: AddCredential) --
  //
  // For Approved + AddCredential cards with parseable holderPersonId,
  // credentialType, and referenceNumber, fire a usePersonCredentials query to
  // check whether the credential already exists. Passing '' when not a candidate
  // suppresses the query via the existing enabled guard in usePersonCredentials.
  // isRecoveryCandidate and isCredRecoveryCandidate are mutually exclusive by
  // operationType -- only one query fires per card.

  const credRecoveryFields = useMemo(
    () => (
      approval.approvalStatus === 'Approved' && approval.operationType === 'AddCredential'
        ? extractCredentialRecoveryFields(approval.payload)
        : null
    ),
    [approval.approvalStatus, approval.operationType, approval.payload],
  );

  const isCredRecoveryCandidate = credRecoveryFields !== null;

  const {
    data: personCredentials,
    isLoading: isCredentialsChecking,
  } = usePersonCredentials(credRecoveryFields?.holderPersonId ?? '');

  const matchingCredential = useMemo(
    () =>
      isCredRecoveryCandidate && personCredentials != null
        ? (personCredentials.find(
            c =>
              c.Type === credRecoveryFields!.credentialType &&
              c.ReferenceNumber === credRecoveryFields!.referenceNumber,
          ) ?? null)
        : null,
    [isCredRecoveryCandidate, personCredentials, credRecoveryFields],
  );

  const isPartialCredentialExecutionRecovery =
    isCredRecoveryCandidate && matchingCredential !== null;

  // -- Deactivation recovery candidate detection (S23-P1: DeactivateCredential) --
  //
  // For Approved + DeactivateCredential cards with parseable credentialId, fire a
  // useGetCredential query to check whether the credential is already inactive.
  // useGetCredential has no IsActive filter so it finds deactivated credentials
  // (usePersonCredentials would filter them out). Passing '' + enabled=false when
  // not a candidate suppresses the query. Mutually exclusive with journey and
  // credential recovery candidates by operationType.

  const deactivationRecoveryFields = useMemo(
    () => (
      approval.approvalStatus === 'Approved' && approval.operationType === 'DeactivateCredential'
        ? extractDeactivationRecoveryFields(approval.payload)
        : null
    ),
    [approval.approvalStatus, approval.operationType, approval.payload],
  );

  const isDeactivationRecoveryCandidate = deactivationRecoveryFields !== null;

  const {
    data: deactivationTargetCredential,
    isLoading: isDeactivationCredentialChecking,
  } = useGetCredential(
    deactivationRecoveryFields?.credentialId ?? '',
    isDeactivationRecoveryCandidate,
  );

  // True when the credential is confirmed inactive -- deactivation already applied.
  const isPartialDeactivationExecutionRecovery =
    isDeactivationRecoveryCandidate && deactivationTargetCredential?.IsActive === false;

  const isPending = isPatchPending || isExecutePending || isRecoverPending || isRecoverCredentialPending || isRecoverDeactivationPending;
  const statusColor = STATUS_COLORS[approval.approvalStatus] ?? 'informative';

  // -- Action handlers (UNCHANGED from S18/S20-P1/P2 except AddCredential toast) --

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
        const rawCredType = typeof parsedPayload?.['credentialType'] === 'string'
          ? parsedPayload['credentialType']
          : '';
        const credTypeLabel = rawCredType
          ? (CREDENTIAL_TYPE_LABELS[rawCredType as CredentialType] ?? rawCredType)
          : '';
        toast.success(
          'Approval executed',
          `${approval.title} -- ${credTypeLabel} credential registered for ${holderPersonId}.`,
        );
      } else if (opType === 'DeactivateCredential') {
        const holderPersonId = typeof parsedPayload?.['holderPersonId'] === 'string'
          ? parsedPayload['holderPersonId']
          : approval.targetPersonId ?? 'unknown';
        const credentialId = typeof parsedPayload?.['credentialId'] === 'string'
          ? parsedPayload['credentialId']
          : approval.targetId ?? 'unknown';
        toast.success(
          'Approval executed',
          `${approval.title} -- ${credentialId} deactivated for ${holderPersonId}.`,
        );
      } else if (opType === 'AddPerson') {
        const fullName = typeof parsedPayload?.['fullName'] === 'string'
          ? parsedPayload['fullName']
          : 'unknown';
        toast.success(
          'Approval executed',
          `${approval.title} -- Person record created for ${fullName}.`,
        );
      } else if (opType === 'AddMissionParticipant' || opType === 'RemoveMissionParticipant') {
        const missionId = typeof parsedPayload?.['missionId'] === 'string' ? parsedPayload['missionId'] : 'unknown';
        const personId = typeof parsedPayload?.['personId'] === 'string'
          ? parsedPayload['personId']
          : approval.targetPersonId ?? 'unknown';
        toast.success(
          'Approval executed',
          opType === 'AddMissionParticipant'
            ? `${approval.title} -- ${personId} added to ${missionId}.`
            : `${approval.title} -- ${personId} removed from ${missionId}.`,
        );
      } else {
        // InitiateJourney or other (default)
        const personId = typeof parsedPayload?.['personId'] === 'string'
          ? parsedPayload['personId']
          : approval.targetPersonId ?? 'unknown';
        toast.success(
          'Approval executed',
          `${approval.title} -- Journey created for ${personId}.`,
        );
      }
    } catch (err) {
      if (err instanceof DuplicateJourneyError) {
        toast.error(
          'Execution blocked -- duplicate journey',
          'An active Onboarding journey already exists for this person. ' +
          'Approval has been marked ExecutionFailed.',
        );
      } else if (err instanceof PayloadValidationError) {
        toast.error(
          'Execution blocked -- invalid payload',
          'The approval payload is missing or malformed. No record was created. ' +
          'Contact support to correct the C3Approvals record.',
        );
      } else if (err instanceof PartialExecutionError) {
        toast.error(
          'Partial execution -- manual resolution required',
          'Journey was created but the approval record could not be stamped Executed. ' +
          'Manually update C3Approvals to Executed status.',
        );
      } else if (err instanceof PartialCredentialExecutionError) {
        toast.error(
          'Partial execution -- manual resolution required',
          'Credential was registered but the approval record could not be stamped Executed. ' +
          'Manually update C3Approvals to Executed status.',
        );
      } else if (err instanceof CredentialAlreadyInactiveError) {
        toast.error(
          'Execution blocked -- credential already inactive',
          'This credential is already IsActive = false. ' +
          'Use Recover Execution Stamp to stamp the approval as Executed.',
        );
      } else if (err instanceof PartialDeactivationExecutionError) {
        toast.error(
          'Partial execution -- manual resolution required',
          'Credential was deactivated but the approval record could not be stamped Executed. ' +
          'Manually update C3Approvals to Executed status.',
        );
      } else if (err instanceof PartialAddPersonExecutionError) {
        toast.error(
          'Partial execution -- manual resolution required',
          'Person record was created in C3People but the approval record could not be stamped ' +
          'Executed. Manually update C3Approvals to Executed status.',
        );
      } else if (
        err instanceof PartialParticipantAddExecutionError ||
        err instanceof PartialParticipantRemovalExecutionError
      ) {
        toast.error(
          'Partial execution -- re-execute to repair',
          'The participant change was applied but the approval stamp failed. ' +
          'Execute this approval again: the write is idempotent and only the stamp will be repaired.',
        );
      } else if (err instanceof ParticipantConflictError) {
        toast.error(
          'Execution blocked -- conflicting participant row',
          'An active participant row exists with different fields than the approved request. ' +
          'Approval marked ExecutionFailed. Reconcile the existing row before resubmitting.',
        );
      } else if (err instanceof ActiveKitDependencyError) {
        toast.error(
          'Execution blocked -- active kit assignments',
          'The participant still has active kit assignments on this mission. ' +
          'Deactivate the kit items, then execute again.',
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
          'Recovery failed -- no active journey found',
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

  const handleRecoverCredential = async () => {
    try {
      await recoverCredentialAsync(approval);
      toast.success(
        'Execution stamp recovered',
        `${approval.title} marked Executed. Existing credential for ${credRecoveryFields?.holderPersonId ?? ''} was preserved.`,
      );
    } catch (err) {
      if (err instanceof CredentialRecoveryTargetMissingError) {
        toast.error(
          'Recovery failed -- credential not found',
          `No matching credential was found for ${credRecoveryFields?.holderPersonId ?? ''}. ` +
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

  const handleRecoverDeactivation = async () => {
    const credId = deactivationRecoveryFields?.credentialId ?? '';
    const hpid  = deactivationRecoveryFields?.holderPersonId ?? '';
    try {
      await recoverDeactivationAsync(approval);
      toast.success(
        'Execution stamp recovered',
        `${approval.title} marked Executed. Credential ${credId} confirmed inactive for ${hpid}.`,
      );
    } catch (err) {
      if (err instanceof DeactivationRecoveryTargetMissingError) {
        toast.error(
          'Recovery failed -- credential not found',
          `Credential '${credId}' could not be found. Contact support.`,
        );
      } else if (err instanceof DeactivationRecoveryTargetActiveError) {
        toast.error(
          'Recovery blocked -- credential is still active',
          `Credential '${credId}' is still IsActive = true. Use the Execute button to deactivate it.`,
        );
      } else {
        toast.error('Recovery failed', 'Please retry or contact support.');
      }
    }
  };

  // -- Render --

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
      {/* -- Header row -- */}
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

      {/* -- Core detail grid -- */}
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

      {/* -- Payload summary (S20-P1 + S20-P3) -- */}
      <PayloadSummary raw={approval.payload} operationType={approval.operationType} />

      {/* -- Owner action row -- */}
      {isOwner && (() => {

        // -- Submitted / InReview: Approve + Reject (UNCHANGED) --
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

        // -- Approved: Execute OR Recover (S20-P2 / S21-P1) --
        // Priority: journey recovery (S20-P2) > credential recovery (S21-P1) > Execute.
        // isRecoveryCandidate and isCredRecoveryCandidate are mutually exclusive by
        // operationType, so only one existence query fires per card.
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
              {/* Existence check is in-flight for recovery candidates */}
              {isJourneyChecking || (isCredRecoveryCandidate && isCredentialsChecking) || (isDeactivationRecoveryCandidate && isDeactivationCredentialChecking) ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--c3-space-2)' }}>
                  <Spinner size="extra-tiny" />
                  <Text size={200} style={{ color: 'var(--c3-gray-400)' }}>Checking...</Text>
                </div>
              ) : isPartialExecutionRecovery ? (
                /* -- InitiateJourney partial execution recovery (S20-P2) -- */
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
              ) : isPartialCredentialExecutionRecovery ? (
                /* -- AddCredential partial execution recovery (S21-P1) -- */
                <>
                  <MessageBar intent="warning">
                    <MessageBarBody>
                      <Text size={200}>
                        A credential matching this type and reference number already exists for{' '}
                        <strong>{credRecoveryFields!.holderPersonId}</strong>. This may be a
                        partial execution failure. <strong>Recover</strong> will stamp this
                        approval as Executed without creating a new credential.
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
                    onClick={() => void handleRecoverCredential()}
                    disabled={isRecoverCredentialPending}
                  >
                    {isRecoverCredentialPending ? 'Recovering...' : 'Recover Execution Stamp'}
                  </Button>
                </>
              ) : isPartialDeactivationExecutionRecovery ? (
                /* -- DeactivateCredential partial execution recovery (S23-P1) */
                <>
                  <MessageBar intent="warning">
                    <MessageBarBody>
                      <Text size={200}>
                        Credential{' '}
                        <strong>{deactivationRecoveryFields!.credentialId}</strong>{' '}
                        is already inactive (IsActive = false). This may be a partial execution
                        failure. <strong>Recover</strong> will stamp this approval as Executed
                        without re-applying the deactivation.
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
                    onClick={() => void handleRecoverDeactivation()}
                    disabled={isRecoverDeactivationPending}
                  >
                    {isRecoverDeactivationPending ? 'Recovering...' : 'Recover Execution Stamp'}
                  </Button>
                </>
              ) : (
                /* -- Normal Execute path -- */
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

        // -- Rejected / Executed / ExecutionFailed: read-only --
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

  // S31: complete actionable set + windowed terminal history (two queries).
  const actionableQuery = useActionableApprovals();
  const terminalQuery   = useTerminalApprovals();

  const isLoading = actionableQuery.isLoading || terminalQuery.isLoading;

  // Pure, parity-tested view assembly (utils/approvalInboxView.ts):
  // actionable failure ⇒ mode 'error'; terminal failure alone keeps actionable
  // data fully visible with terminal tabs UNAVAILABLE (null counts, never 0).
  const view = useMemo(
    () => buildApprovalInboxView({
      actionable:      actionableQuery.data,
      actionableError: actionableQuery.isError,
      terminal:        terminalQuery.data,
      terminalError:   terminalQuery.isError,
      terminalLimit:   DEFAULT_TERMINAL_HISTORY_LIMIT,
    }),
    [actionableQuery.data, actionableQuery.isError, terminalQuery.data, terminalQuery.isError],
  );
  const { counts, terminalUnavailable, terminalWindowed } = view;

  // -- Visible items for the active tab (null = tab content unavailable) --
  const visibleApprovals = useMemo(
    () => visibleApprovalsForTab(view, activeTab),
    [view, activeTab],
  );

  // -- Loading --
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

  // -- Actionable data unavailable: explicit error state, never empty success --
  if (view.mode === 'error') {
    const err = actionableQuery.error;
    return (
      <div style={{ padding: 'var(--c3-space-8)' }}>
        <EmptyState
          variant="error"
          title="Actionable approvals unavailable"
          description={
            (err instanceof Error ? err.message : 'An unexpected error occurred.') +
            ' No approval counts or lists are shown — the data could not be loaded.'
          }
        />
      </div>
    );
  }

  // -- Main render --
  const pendingCount = counts.pending ?? 0;

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
      {/* -- Page header -- */}
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

      {/* -- Tab bar -- */}
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
            // null = count UNAVAILABLE (query failed) — shown as (—), never 0.
            if (count === null) {
              return (
                <Tab key={tab} value={tab}>
                  {`${label} (—)`}
                </Tab>
              );
            }
            // Windowed tabs: once the terminal window saturates, the loaded
            // count is NOT the total — the '+' suffix keeps the label truthful.
            const windowedTab =
              terminalWindowed && (tab === 'executed' || tab === 'rejected' || tab === 'all');
            const countLabel = windowedTab ? `${count}+` : `${count}`;
            return (
              <Tab key={tab} value={tab}>
                {count > 0 ? `${label} (${countLabel})` : label}
              </Tab>
            );
          })}
        </TabList>
      </div>

      {/* -- Truthful-window / unavailability disclosures (S31) -- */}
      {(activeTab === 'executed' || activeTab === 'rejected') && terminalWindowed && (
        <Text size={200} style={{ color: 'var(--c3-gray-500)' }}>
          Showing the latest {DEFAULT_TERMINAL_HISTORY_LIMIT} Executed and Rejected approvals
          (most recent first). Older terminal history remains in the C3Approvals list.
        </Text>
      )}
      {activeTab === 'all' && !terminalUnavailable && (
        <Text size={200} style={{ color: 'var(--c3-gray-500)' }}>
          This view contains ALL actionable approvals (Pending, Approved, Failed)
          plus recent Executed/Rejected history
          {terminalWindowed ? ` (latest ${DEFAULT_TERMINAL_HISTORY_LIMIT})` : ''}.
        </Text>
      )}
      {activeTab === 'all' && terminalUnavailable && (
        <Text size={200} style={{ color: 'var(--c3-critical)' }}>
          Recent Executed/Rejected history is UNAVAILABLE (its query failed) —
          this view currently shows actionable approvals only.
        </Text>
      )}

      {/* -- Tab content (null = unavailable — an error notice, never empty success) -- */}
      {visibleApprovals === null ? (
        <EmptyState
          variant="error"
          title="Terminal history unavailable"
          description={
            (terminalQuery.error instanceof Error
              ? terminalQuery.error.message
              : 'The Executed/Rejected history query failed.') +
            ' Loaded actionable approvals remain available in the other tabs.'
          }
        />
      ) : visibleApprovals.length === 0 ? (
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
