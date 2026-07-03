/**
 * SharePointApprovalsService.ts
 *
 * Sprint 18 Phase 2B -- SP-backed implementation of IApprovalsService.
 *
 * createApproval: live (derives APR-XXXX, fetches X-RequestDigest, POSTs to C3Approvals).
 * listApprovals:  live (OData $filter on status, maps via spApprovalMapper).
 * patchApprovalStatus: live (MERGE -- stamps ReviewedBy/ReviewedAt + Approved/Rejected status).
 * stampExecution: live (MERGE -- stamps Executed+ExecutedAt, or ExecutionFailed+ExecutionError).
 *                 Executed branch optionally backfills TargetPersonID (AddPerson path -- S25 polish).
 *
 * Design follows the S15/S16/S17 SP service pattern:
 *   - No PnP.js. Native fetch with credentials: 'same-origin'.
 *   - Accept: application/json;odata=nometadata for GET responses.
 *   - Content-Type: application/json;odata=verbose for POST body.
 *   - X-RequestDigest fetched fresh per write call -- never cached.
 *     Digest TTL is 30 minutes; fetching per-call avoids stale-digest 403s.
 *
 * SubmittedBy is stamped from currentUserLoginName captured in the factory
 * closure -- callers do not supply identity.
 *
 * __metadata.type: SP.Data.C3ApprovalsListItem is derived from the list title.
 * Verify against /_api/web/lists/getbytitle('C3Approvals')?$select=ListItemEntityTypeFullName
 * before the first live POST.
 *
 * See: docs/architecture/C3Approvals SP List Schema.md
 * See: docs/adr/ADR-013-Governance-Approval-Pattern.md
 */

import type {
  IApprovalsService,
  CreateApprovalRequest,
  CreateApprovalResult,
  PatchApprovalStatusRequest,
  StampExecutionRequest,
} from '../interfaces/IApprovalsService';
import { deriveApprovalTitle, mapSpItemsToApprovals, type SpApprovalItem } from '@c3/utils/spApprovalMapper';
import type { C3Approval } from '@c3/utils/spApprovalMapper';

const PREFIX = '[C3/Approvals]';
const LIST_NAME = 'C3Approvals';
const LIST_ITEM_TYPE = 'SP.Data.C3ApprovalsListItem';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildListUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/$/, '')}/_api/web/lists/getbytitle('${LIST_NAME}')/items`;
}

function buildContextInfoUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/$/, '')}/_api/contextinfo`;
}

function buildItemUrl(siteUrl: string, id: number): string {
  return `${siteUrl.replace(/\/$/, '')}/_api/web/lists/getbytitle('${LIST_NAME}')/items(${id})`;
}

/**
 * Fetch a fresh Form Digest Value from SP for write operations.
 * Never cache -- digest TTL is 30 minutes and staleness causes silent 403s.
 */
async function fetchFormDigest(siteUrl: string): Promise<string> {
  const response = await fetch(buildContextInfoUrl(siteUrl), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json;odata=nometadata' },
  });

  if (!response.ok) {
    throw new Error(
      `${PREFIX} fetchFormDigest: /_api/contextinfo returned HTTP ${response.status} ${response.statusText}`,
    );
  }

  const json = (await response.json()) as { FormDigestValue?: string };
  if (!json.FormDigestValue) {
    throw new Error(`${PREFIX} fetchFormDigest: FormDigestValue absent in contextinfo response`);
  }

  return json.FormDigestValue;
}

/**
 * Execute a MERGE (update) against a single list item.
 * Shared by patchApprovalStatus and stampExecution.
 */
async function mergeItem(
  siteUrl: string,
  id: number,
  body: Record<string, unknown>,
): Promise<void> {
  const digest = await fetchFormDigest(siteUrl);

  const response = await fetch(buildItemUrl(siteUrl, id), {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Accept':          'application/json;odata=nometadata',
      'Content-Type':    'application/json;odata=verbose',
      'X-RequestDigest': digest,
      'X-HTTP-Method':   'MERGE',
      'IF-MATCH':        '*',
    },
    body: JSON.stringify({ __metadata: { type: LIST_ITEM_TYPE }, ...body }),
  });

  // SP MERGE returns 204 No Content on success
  if (!response.ok) {
    const errorText = await response.text().catch(() => '(unreadable)');
    throw new Error(
      `${PREFIX} mergeItem(${id}): HTTP ${response.status} ${response.statusText}. Body: ${errorText}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createSharePointApprovalsService = (
  siteUrl: string,
  currentUserLoginName: string,
): IApprovalsService => ({

  async createApproval(req: CreateApprovalRequest): Promise<CreateApprovalResult> {
    // S29B immutable-submission hardening: ONE requester-authorized write.
    //
    // The pre-S29B flow POSTed a TMP title and MERGEd the APR-XXXX back — that
    // second write required EditListItems for submitters, leaving their own
    // approval rows editable after submission (an unacceptable ADR-013
    // boundary). The MERGE is eliminated:
    //
    //   POST complete payload once (Title = non-authoritative correlation
    //   value, generated pre-submission, never parsed as identity)
    //   → receive the created item Id
    //   → derive the displayed APR-XXXX from the Id (deriveApprovalTitle —
    //     the SAME derivation the legacy flow used, so identifiers are
    //     consistent across both schemes)
    //
    // Submitters therefore need Add-only operational access; submitted rows
    // are immutable to their creator. Owner lifecycle writes (approve/reject/
    // execute/stamp) are unchanged and address items(Id) under owner rights.
    const correlation = `APR-PENDING-${Date.now().toString(36)}-${Math.floor(Math.random() * 46656).toString(36)}`;
    const digest = await fetchFormDigest(siteUrl);

    const body = {
      __metadata: { type: LIST_ITEM_TYPE },
      Title:          correlation,
      OperationType:  req.operationType,
      TargetID:       req.targetId ?? null,
      TargetPersonID: req.targetPersonId,
      SubmittedBy:    currentUserLoginName,
      SubmittedAt:    new Date().toISOString(),
      ApprovalStatus: 'Submitted',
      Reason:         req.reason ?? null,
      Payload:        req.payload,
    };

    const response = await fetch(buildListUrl(siteUrl), {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Accept':          'application/json;odata=nometadata',
        'Content-Type':    'application/json;odata=verbose',
        'X-RequestDigest': digest,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '(unreadable)');
      throw new Error(
        `${PREFIX} createApproval: HTTP ${response.status} ${response.statusText}. Body: ${errorText}`,
      );
    }

    const created = (await response.json()) as { ID?: number };
    if (typeof created.ID !== 'number') {
      throw new Error(
        `${PREFIX} createApproval: SP did not return an item ID after POST. ` +
        `A row with correlation Title '${correlation}' may exist in C3Approvals; its ApprovalID ` +
        `derives from its item ID on next read (no orphan-identity risk).`,
      );
    }

    const title = deriveApprovalTitle(created.ID, null);

    console.info(`${PREFIX} createApproval: created ${title} (SP ID ${created.ID}) for ${req.targetPersonId} — single write, no Title MERGE`);
    return { approvalId: created.ID, title, status: 'Submitted' };
  },

  async listApprovals(filter?: { status?: string[] }): Promise<C3Approval[]> {
    const statuses = filter?.status ?? ['Submitted', 'InReview'];

    const statusFilter = statuses
      .map(s => `ApprovalStatus eq '${s}'`)
      .join(' or ');

    const url =
      `${buildListUrl(siteUrl)}` +
      `?$filter=${encodeURIComponent(statusFilter)}` +
      `&$orderby=SubmittedAt%20desc` +
      `&$top=500`;

    const response = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json;odata=nometadata' },
    });

    if (!response.ok) {
      throw new Error(`${PREFIX} listApprovals: HTTP ${response.status} ${response.statusText}`);
    }

    const json = (await response.json()) as { value: SpApprovalItem[] };
    const { approvals: items } = mapSpItemsToApprovals(json.value ?? []);

    console.info(`${PREFIX} listApprovals: ${items.length} items (filter: ${statuses.join(', ')})`);
    return items;
  },

  async getApproval(_id: number): Promise<null> {
    console.warn(`${PREFIX} getApproval: not implemented -- Phase 4`);
    throw new Error(`${PREFIX} getApproval: not implemented`);
  },

  async patchApprovalStatus(id: number, req: PatchApprovalStatusRequest): Promise<void> {
    if (req.newStatus === 'Rejected' && !req.rejectionReason?.trim()) {
      throw new Error(`${PREFIX} patchApprovalStatus: rejectionReason is required when rejecting`);
    }

    const body: Record<string, unknown> = {
      ApprovalStatus: req.newStatus,
      ReviewedBy:     currentUserLoginName,
      ReviewedAt:     new Date().toISOString(),
    };

    if (req.newStatus === 'Rejected') {
      body['RejectionReason'] = req.rejectionReason ?? '';
    }

    await mergeItem(siteUrl, id, body);
    console.info(`${PREFIX} patchApprovalStatus: ID ${id} -> ${req.newStatus}`);
  },

  async stampExecution(id: number, req: StampExecutionRequest): Promise<void> {
    let body: Record<string, unknown>;

    if (req.newStatus === 'Executed') {
      // Executed: stamp ExecutedAt + clear ExecutionError.
      // If targetPersonId is supplied (AddPerson path), backfill TargetPersonID
      // in the same MERGE -- the approval was submitted with PENDING-ADDPERSON
      // because no PER-XXXX existed at submission time.
      body = {
        ApprovalStatus: 'Executed',
        ExecutedAt:     req.executedAt,
        ExecutionError: null,
      };
      if (req.targetPersonId) {
        body['TargetPersonID'] = req.targetPersonId;
      }
    } else {
      // ExecutionFailed: stamp ExecutionError -- do NOT set ExecutedAt
      body = {
        ApprovalStatus: 'ExecutionFailed',
        ExecutionError: req.executionError,
        ExecutedAt:     null,
      };
    }

    await mergeItem(siteUrl, id, body);
    console.info(`${PREFIX} stampExecution: ID ${id} -> ${req.newStatus}`);
  },
});
