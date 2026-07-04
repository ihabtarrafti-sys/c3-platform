/**
 * SharePointApprovalsService.ts
 *
 * Sprint 18 Phase 2B -- SP-backed implementation of IApprovalsService.
 * Sprint 29B -- immutable Add-only submission (single POST, Id-derived APR).
 * Sprint 31 -- Approval Query Integrity: internally paged read core with
 *              targeted semantic methods, Id-desc authoritative ordering,
 *              fail-closed page/mapper handling, fresh single-row reads with
 *              ETags, and ETag-preconditioned status updates.
 *
 * Read core rules (Approval Query Integrity — Sprint 31.md §3):
 *   - Authoritative ordering is Id desc (monotonic, unique, index-safe).
 *     SubmittedAt is client-clock data — display only.
 *   - Separate single-status indexed queries; merged, deduped by Id (fresher
 *     fetch wins), sorted Id desc.
 *   - Complete queries follow odata.nextLink to exhaustion; every followed
 *     link is validated as a same-origin /_api/ URL first.
 *   - AbortSignal propagates through every page request; cancellation rejects
 *     with AbortError — never an empty successful result.
 *   - Fail closed: a failed/malformed page, or ANY mapper-rejected row on a
 *     complete query (ApprovalQueryIntegrityError), rejects the whole call.
 *
 * Write pattern unchanged from S18/S29B:
 *   - No PnP.js. Native fetch with credentials: 'same-origin'.
 *   - X-RequestDigest fetched fresh per write call -- never cached.
 *   - S31: when callers supply the ETag from a freshness read, it becomes the
 *     IF-MATCH precondition. The '*' fallback exists ONLY for unmigrated
 *     legacy callers and is not a precedent for new update paths.
 *
 * `fetchImpl` is injectable for the compiled-from-source s31 parity harness —
 * production callers omit it and get the ambient fetch.
 *
 * See: docs/architecture/C3Approvals SP List Schema.md
 * See: docs/architecture/Approval Query Integrity — Sprint 31.md
 * See: docs/adr/ADR-013-Governance-Approval-Pattern.md
 */

import type {
  ApprovalQueryOptions,
  ApprovalReadResult,
  IApprovalsService,
  CreateApprovalRequest,
  CreateApprovalResult,
  PatchApprovalStatusRequest,
  StampExecutionRequest,
} from '../interfaces/IApprovalsService';
import {
  ACTIONABLE_STATUSES,
  DEFAULT_TERMINAL_HISTORY_LIMIT,
  PENDING_STATUSES,
  TERMINAL_STATUSES,
} from '../interfaces/IApprovalsService';
import { ApprovalQueryIntegrityError } from '../errors';
import {
  deriveApprovalTitle,
  mapSpItemToApproval,
  mapSpItemsToApprovals,
  type SpApprovalItem,
} from '@c3/utils/spApprovalMapper';
import type { C3Approval } from '@c3/utils/spApprovalMapper';

const PREFIX = '[C3/Approvals]';
const LIST_NAME = 'C3Approvals';
const LIST_ITEM_TYPE = 'SP.Data.C3ApprovalsListItem';
const PAGE_SIZE = 500;

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

/** OData string-literal escaping: single quotes are doubled. */
function encodeODataLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Validate a paging URL before following it: must be an absolute same-origin
 * SharePoint URL under /_api/. Anything else is treated as an untrusted page
 * source and fails the whole query (rule 9).
 */
function assertTrustedNextLink(nextLink: string, siteUrl: string): void {
  let next: URL;
  let site: URL;
  try {
    next = new URL(nextLink);
    site = new URL(siteUrl);
  } catch {
    throw new Error(`${PREFIX} paging: unparseable odata.nextLink '${nextLink}' — failing closed.`);
  }
  if (next.origin !== site.origin || !next.pathname.includes('/_api/')) {
    throw new Error(
      `${PREFIX} paging: odata.nextLink '${nextLink}' is not a same-origin SharePoint API URL — failing closed.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createSharePointApprovalsService = (
  siteUrl: string,
  currentUserLoginName: string,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): IApprovalsService => {

  /**
   * Fetch a fresh Form Digest Value from SP for write operations.
   * Never cache -- digest TTL is 30 minutes and staleness causes silent 403s.
   */
  async function fetchFormDigest(): Promise<string> {
    const response = await fetchImpl(buildContextInfoUrl(siteUrl), {
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
   *
   * S31: `etag` (from the caller's freshness read) becomes the IF-MATCH
   * precondition; a 412 surfaces as a truthful concurrency failure. The '*'
   * fallback serves only unmigrated legacy callers.
   */
  async function mergeItem(
    id: number,
    body: Record<string, unknown>,
    etag?: string,
  ): Promise<void> {
    const digest = await fetchFormDigest();

    const response = await fetchImpl(buildItemUrl(siteUrl, id), {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Accept':          'application/json;odata=nometadata',
        'Content-Type':    'application/json;odata=verbose',
        'X-RequestDigest': digest,
        'X-HTTP-Method':   'MERGE',
        'IF-MATCH':        etag ?? '*',
      },
      body: JSON.stringify({ __metadata: { type: LIST_ITEM_TYPE }, ...body }),
    });

    if (response.status === 412) {
      throw new Error(
        `${PREFIX} mergeItem(${id}): HTTP 412 — the approval row changed after it was read. ` +
        `Refresh the inbox and retry; do not repeat the action against stale state.`,
      );
    }

    // SP MERGE returns 204 No Content on success
    if (!response.ok) {
      const errorText = await response.text().catch(() => '(unreadable)');
      throw new Error(
        `${PREFIX} mergeItem(${id}): HTTP ${response.status} ${response.statusText}. Body: ${errorText}`,
      );
    }
  }

  /**
   * S31 paged read core: fetch every page of one query, following
   * odata.nextLink to exhaustion (or until maxItems for windowed queries).
   * Fail-closed on any non-OK page, malformed body, or untrusted next link.
   */
  async function fetchPages(
    query: string,
    opts: { signal?: AbortSignal; maxItems?: number },
  ): Promise<SpApprovalItem[]> {
    const items: SpApprovalItem[] = [];
    let url: string | null = `${buildListUrl(siteUrl)}?${query}`;
    let firstPage = true;

    while (url) {
      if (!firstPage) assertTrustedNextLink(url, siteUrl);
      firstPage = false;

      const response = await fetchImpl(url, {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json;odata=nometadata' },
        signal: opts.signal,
      });

      if (!response.ok) {
        throw new Error(
          `${PREFIX} paged read: page request failed (HTTP ${response.status} ${response.statusText}) — ` +
          `failing closed; no partial assembly is returned.`,
        );
      }

      const json = (await response.json()) as {
        value?: unknown;
        'odata.nextLink'?: string;
      };
      if (!Array.isArray(json.value)) {
        throw new Error(
          `${PREFIX} paged read: malformed page body (missing 'value' array) — failing closed.`,
        );
      }

      items.push(...(json.value as SpApprovalItem[]));

      if (opts.maxItems !== undefined && items.length >= opts.maxItems) break;
      url = json['odata.nextLink'] ?? null;
    }

    return items;
  }

  /** Single-status page-complete query (rule 3: no multi-value OR filters). */
  function statusQuery(status: string, top: number): string {
    return (
      `$filter=${encodeURIComponent(`ApprovalStatus eq '${encodeODataLiteral(status)}'`)}` +
      `&$orderby=Id%20desc&$top=${top}`
    );
  }

  /**
   * Map raw items for a COMPLETE query. Any mapper rejection raises
   * ApprovalQueryIntegrityError with the rejected item IDs (clarification 1).
   */
  function mapComplete(rawItems: SpApprovalItem[], label: string): C3Approval[] {
    const { approvals, result } = mapSpItemsToApprovals(rawItems);
    if (result.rejected > 0) {
      const mappedIds = new Set(approvals.map(a => a.id));
      const rejectedIds = rawItems
        .map(i => i.ID)
        .filter(id => id == null || isNaN(id) || !mappedIds.has(id))
        .map(id => (id == null || isNaN(id) ? -1 : id));
      throw new ApprovalQueryIntegrityError(label, rejectedIds, rawItems.length);
    }
    return approvals;
  }

  /**
   * Run one single-status complete query per status; merge; dedupe by Id with
   * the fresher (later-executed) fetch winning; sort Id desc; integrity-check.
   */
  async function listByStatusesComplete(
    statuses: readonly string[],
    label: string,
    signal?: AbortSignal,
  ): Promise<C3Approval[]> {
    const byId = new Map<number, SpApprovalItem>();
    let fetched = 0;
    for (const status of statuses) {
      const raw = await fetchPages(statusQuery(status, PAGE_SIZE), { signal });
      fetched += raw.length;
      for (const item of raw) byId.set(item.ID, item); // later fetch wins
    }
    const approvals = mapComplete([...byId.values()], label);
    approvals.sort((a, b) => b.id - a.id);
    console.info(`${PREFIX} ${label}: ${approvals.length} items (fetched ${fetched} across ${statuses.length} status queries)`);
    return approvals;
  }

  return {

    async createApproval(req: CreateApprovalRequest): Promise<CreateApprovalResult> {
      // S29B immutable-submission hardening: ONE requester-authorized write.
      //
      // POST complete payload once (Title = non-authoritative correlation
      // value, never parsed as identity) → receive the created item Id →
      // derive the displayed APR-XXXX from the Id (deriveApprovalTitle).
      // Submitters need Add-only operational access; submitted rows are
      // immutable to their creator.
      const correlation = `APR-PENDING-${Date.now().toString(36)}-${Math.floor(Math.random() * 46656).toString(36)}`;
      const digest = await fetchFormDigest();

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

      const response = await fetchImpl(buildListUrl(siteUrl), {
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

    // ── LEGACY read (pre-S31 contract, unchanged): single request, $top=500,
    //    SubmittedAt-desc. Production consumers migrated to the semantic
    //    methods below; retained for contract stability only. ───────────────
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

      const response = await fetchImpl(url, {
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

    async listPendingApprovals(opts?: ApprovalQueryOptions): Promise<C3Approval[]> {
      return listByStatusesComplete(PENDING_STATUSES, 'listPendingApprovals', opts?.signal);
    },

    async listActionableApprovals(opts?: ApprovalQueryOptions): Promise<C3Approval[]> {
      return listByStatusesComplete(ACTIONABLE_STATUSES, 'listActionableApprovals', opts?.signal);
    },

    async listApprovalsByPerson(
      personId: string,
      opts?: ApprovalQueryOptions,
    ): Promise<C3Approval[]> {
      const trimmed = personId.trim();
      if (!trimmed) return [];
      const query =
        `$filter=${encodeURIComponent(`TargetPersonID eq '${encodeODataLiteral(trimmed)}'`)}` +
        `&$orderby=Id%20desc&$top=${PAGE_SIZE}`;
      const raw = await fetchPages(query, { signal: opts?.signal });
      const approvals = mapComplete(raw, `listApprovalsByPerson(${trimmed})`);
      approvals.sort((a, b) => b.id - a.id);
      console.info(`${PREFIX} listApprovalsByPerson: ${approvals.length} items for ${trimmed}`);
      return approvals;
    },

    async listRecentTerminalApprovals(
      opts?: ApprovalQueryOptions & { limit?: number },
    ): Promise<C3Approval[]> {
      const limit = opts?.limit ?? DEFAULT_TERMINAL_HISTORY_LIMIT;
      const byId = new Map<number, SpApprovalItem>();
      for (const status of TERMINAL_STATUSES) {
        const raw = await fetchPages(statusQuery(status, Math.min(limit, PAGE_SIZE)), {
          signal: opts?.signal,
          maxItems: limit,
        });
        for (const item of raw) byId.set(item.ID, item);
      }
      // Windowed query: mapper rejections still fail closed — a hidden rejected
      // row inside the window would silently understate recent history.
      const approvals = mapComplete([...byId.values()], 'listRecentTerminalApprovals');
      approvals.sort((a, b) => b.id - a.id);
      const windowed = approvals.slice(0, limit);
      console.info(`${PREFIX} listRecentTerminalApprovals: ${windowed.length} items (window ${limit})`);
      return windowed;
    },

    async getApproval(id: number, opts?: ApprovalQueryOptions): Promise<ApprovalReadResult | null> {
      // Fresh single-row read by the retained SP numeric item Id — the APR
      // display Title is NEVER parsed to obtain persistence identity.
      // odata=minimalmetadata so the body carries the row's current ETag.
      const response = await fetchImpl(buildItemUrl(siteUrl, id), {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json;odata=minimalmetadata' },
        signal: opts?.signal,
      });

      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error(`${PREFIX} getApproval(${id}): HTTP ${response.status} ${response.statusText}`);
      }

      const json = (await response.json()) as SpApprovalItem & { 'odata.etag'?: string };
      const warnRef = { count: 0 };
      const approval = mapSpItemToApproval(json, warnRef);
      if (approval === null) {
        // The row EXISTS but fails mapping — truthful corruption signal,
        // never null (null strictly means not-found).
        throw new ApprovalQueryIntegrityError(`getApproval(${id})`, [id], 1);
      }

      return { approval, etag: json['odata.etag'] ?? null };
    },

    async patchApprovalStatus(id: number, req: PatchApprovalStatusRequest, etag?: string): Promise<void> {
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

      await mergeItem(id, body, etag);
      console.info(`${PREFIX} patchApprovalStatus: ID ${id} -> ${req.newStatus}`);
    },

    async stampExecution(id: number, req: StampExecutionRequest, etag?: string): Promise<void> {
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

      await mergeItem(id, body, etag);
      console.info(`${PREFIX} stampExecution: ID ${id} -> ${req.newStatus}`);
    },
  };
};
