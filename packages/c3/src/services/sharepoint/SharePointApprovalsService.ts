/**
 * SharePointApprovalsService.ts
 *
 * Sprint 18 Phase 2B -- SP-backed implementation of IApprovalsService.
 *
 * createApproval: live (derives APR-XXXX, fetches X-RequestDigest, POSTs to C3Approvals).
 * listApprovals:  live (OData $filter on status, maps via spApprovalMapper).
 * patchApprovalStatus: live (MERGE -- stamps ReviewedBy/ReviewedAt + Approved/Rejected status).
 * stampExecution: live (MERGE -- stamps Executed+ExecutedAt, or ExecutionFailed+ExecutionError).
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
import { mapSpItemsToApprovals, type SpApprovalItem } from '@c3/utils/spApprovalMapper';
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
 * Derive the next APR-XXXX sequence number.
 * Gets the most-recently created item by ID (descending), parses the title,
 * and increments. Returns 1 if no items exist.
 *
 * Not atomic -- see module-level comment on sequence number race.
 */
interface TitleItem { Title: string | null }
interface TitleResponse { value: TitleItem[] }

async function deriveNextSequenceNumber(siteUrl: string): Promise<number> {
  const url =
    `${siteUrl.replace(/\/$/, '')}/_api/web/lists/getbytitle('${LIST_NAME}')/items` +
    `?$select=Title&$orderby=ID%20desc&$top=1`;

  const response = await fetch(url, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json;odata=nometadata' },
  });

  if (!response.ok) {
    throw new Error(
      `${PREFIX} deriveNextSequenceNumber: HTTP ${response.status} ${response.statusText}`,
    );
  }

  const json = (await response.json()) as TitleResponse;

  if (!Array.isArray(json.value) || json.value.length === 0) {
    return 1;
  }

  const lastTitle = json.value[0].Title;
  if (!lastTitle) return 1;

  const match = lastTitle.match(/^APR-(\d+)$/i);
  if (!match) return 1;

  return parseInt(match[1], 10) + 1;
}

function formatApprovalId(n: number): string {
  return `APR-${String(n).padStart(4, '0')}`;
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
    const seq   = await deriveNextSequenceNumber(siteUrl);
    const title = formatApprovalId(seq);
    const digest = await fetchFormDigest(siteUrl);

    const body = {
      __metadata: { type: LIST_ITEM_TYPE },
      Title:          title,
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

    const created = (await response.json()) as { ID?: number; Title?: string };
    const approvalId = typeof created.ID === 'number' ? created.ID : seq;

    console.info(`${PREFIX} createApproval: created ${title} (ID ${approvalId}) for ${req.targetPersonId}`);
    return { approvalId, title, status: 'Submitted' };
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
      // Executed: stamp ExecutedAt + clear ExecutionError
      body = {
        ApprovalStatus: 'Executed',
        ExecutedAt:     req.executedAt,
        ExecutionError: null,
      };
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
