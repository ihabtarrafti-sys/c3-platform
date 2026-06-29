/**
 * SharePointApprovalsService.ts
 *
 * Sprint 18 Phase 2B — SP-backed implementation of IApprovalsService.
 *
 * createApproval is live: derives the next APR-XXXX sequence, fetches a fresh
 * X-RequestDigest from /_api/contextinfo, then POSTs to C3Approvals.
 *
 * listApprovals, getApproval, patchApprovalStatus are Phase 3 stubs that throw.
 *
 * Design follows the S15/S16/S17 SP service pattern:
 *   - No PnP.js. Native fetch with credentials: 'same-origin'.
 *   - Accept: application/json;odata=nometadata for GET responses.
 *   - Content-Type: application/json;odata=verbose for POST body.
 *   - X-RequestDigest fetched fresh per write call — never cached.
 *     Digest TTL is 30 minutes; fetching per-call avoids stale-digest 403s.
 *
 * SubmittedBy is stamped from currentUserLoginName captured in the factory
 * closure — callers do not supply identity.
 *
 * Sequence number note: GET-last-then-increment is not atomic. Concurrent
 * submissions could derive the same APR title. SP does not enforce uniqueness
 * on Title. Acceptable for Phase 2B (single-user, single-submission flow).
 * Documented in C3Approvals SP List Schema.md.
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
} from '../interfaces/IApprovalsService';

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

/**
 * Fetch a fresh Form Digest Value from SP for write operations.
 * Never cache — digest TTL is 30 minutes and staleness causes silent 403s.
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
 * Not atomic — see module-level comment on sequence number race.
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
    return 1; // No existing items — start at APR-0001
  }

  const lastTitle = json.value[0].Title;
  if (!lastTitle) return 1;

  // Parse "APR-XXXX" → extract the numeric part
  const match = lastTitle.match(/^APR-(\d+)$/i);
  if (!match) return 1;

  return parseInt(match[1], 10) + 1;
}

function formatApprovalId(n: number): string {
  return `APR-${String(n).padStart(4, '0')}`;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createSharePointApprovalsService = (
  siteUrl: string,
  currentUserLoginName: string,
): IApprovalsService => ({

  async createApproval(req: CreateApprovalRequest): Promise<CreateApprovalResult> {
    // Step 1: derive next sequence number
    const seq   = await deriveNextSequenceNumber(siteUrl);
    const title = formatApprovalId(seq);

    // Step 2: fetch fresh form digest for write
    const digest = await fetchFormDigest(siteUrl);

    // Step 3: POST new list item
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
        `${PREFIX} createApproval: HTTP ${response.status} ${response.statusText}. ` +
        `Body: ${errorText}`,
      );
    }

    const created = (await response.json()) as { ID?: number; Title?: string };

    // SP returns the created item; use its ID if available, else fall back to seq
    const approvalId = typeof created.ID === 'number' ? created.ID : seq;

    console.info(`${PREFIX} createApproval: created ${title} (ID ${approvalId}) for ${req.targetPersonId}`);

    return { approvalId, title, status: 'Submitted' };
  },

  async listApprovals(_filter?: Record<string, unknown>): Promise<never[]> {
    console.warn(`${PREFIX} listApprovals: not implemented — Phase 3`);
    throw new Error(`${PREFIX} listApprovals: not implemented`);
  },

  async getApproval(_id: number): Promise<null> {
    console.warn(`${PREFIX} getApproval: not implemented — Phase 3`);
    throw new Error(`${PREFIX} getApproval: not implemented`);
  },

  async patchApprovalStatus(_id: number, _update: Record<string, unknown>): Promise<never> {
    console.warn(`${PREFIX} patchApprovalStatus: not implemented — Phase 3`);
    throw new Error(`${PREFIX} patchApprovalStatus: not implemented`);
  },
});
