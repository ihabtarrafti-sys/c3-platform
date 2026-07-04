/**
 * SharePointContractService.ts
 *
 * Sprint 24 Phase 1 — Rewritten with native fetch (TD-04 resolved).
 * Sprint 32 — Read integrity: ALL swallowed failures removed. This service now
 * fails closed like every post-S31 read surface:
 *
 *   - network / HTTP / JSON-parse / malformed-body failures THROW — they are
 *     never converted into an empty contract list;
 *   - HTTP 404 throws ContractsListUnprovisionedError — "list not provisioned"
 *     is an UNAVAILABLE state, distinguished from a successful empty list;
 *   - a successful 200 with zero rows returns [] — the truthful genuine-empty
 *     result (the canonical list exists and simply has no contracts);
 *   - every fetched row is validated against the canonical flat schema BEFORE
 *     mapping (validateSpContractItem): missing required canonical fields or
 *     lookup-object values are REJECTED with ContractReadIntegrityError and
 *     the offending item IDs — never coerced, never partially returned;
 *   - getContract propagates list-read failures truthfully and still throws
 *     its own not-found error for a valid-but-absent ContractID;
 *   - listRenewalContracts inherits all of the above — Renewals can no longer
 *     translate unavailable contract data into an empty-success view.
 *
 * Targets: C3Contracts (canonical flat schema — no lookup handling; the
 * pre-canonical mock list's lookup rows are rejected by validation, which is
 * intentional: the canonical reprovision is the fix, not mapper coercion).
 *
 * `fetchImpl` is injectable for the compiled-from-source s32 parity harness —
 * production callers omit it and get the ambient fetch.
 *
 * See: docs/architecture/C3Contracts SP List Schema.md
 * See: docs/architecture/Canonical Contracts Reset — Sprint 32.md
 */

import { mapContract, validateSpContractItem, type SPContractItem } from '@c3/mappers';
import type { Activity, Contract } from '@c3/types';
import { ContractReadIntegrityError, ContractsListUnprovisionedError } from '../errors';
import type { IContractService } from '../interfaces/IContractService';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PREFIX = '[C3/Contracts]';
const LIST_NAME = 'C3Contracts';
const PAGE_SIZE = 500;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildListUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/$/, '')}/_api/web/lists/getbytitle('${LIST_NAME}')/items`;
}

/** Escape embedded single-quotes for OData $filter string literals. */
function escOData(val: string): string {
  return val.replace(/'/g, "''");
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createSharePointContractService = (
  siteUrl: string,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): IContractService => {
  const baseUrl = buildListUrl(siteUrl);

  /**
   * Fetch, validate, and map C3Contracts rows — FAIL CLOSED on every failure
   * class. Returns typed Contract[] only when every row is canonically valid.
   */
  async function fetchContracts(url: string, label: string): Promise<Contract[]> {
    const response = await fetchImpl(url, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json;odata=nometadata' },
    });

    if (response.status === 404) throw new ContractsListUnprovisionedError();
    if (!response.ok) {
      throw new Error(
        `${PREFIX} ${label}: SharePoint returned HTTP ${response.status} ${response.statusText} — ` +
        `contract data is UNAVAILABLE (not empty).`,
      );
    }

    let json: { value?: unknown };
    try {
      json = (await response.json()) as { value?: unknown };
    } catch {
      throw new Error(`${PREFIX} ${label}: malformed (non-JSON) SharePoint response — failing closed.`);
    }
    if (!Array.isArray(json.value)) {
      throw new Error(`${PREFIX} ${label}: malformed response body (missing 'value' array) — failing closed.`);
    }

    const items = json.value as (SPContractItem & Record<string, unknown>)[];

    // Canonical row validation — rejection, never coercion.
    const rejectedIds: number[] = [];
    let firstDetail = '';
    for (const item of items) {
      const errors = validateSpContractItem(item);
      if (errors.length > 0) {
        rejectedIds.push(typeof item.Id === 'number' && isFinite(item.Id) ? item.Id : -1);
        if (!firstDetail) firstDetail = `First failure (item ${item.Id ?? '?'}): ${errors[0]}`;
      }
    }
    if (rejectedIds.length > 0) {
      throw new ContractReadIntegrityError(rejectedIds, items.length, firstDetail);
    }

    return items.map(mapContract);
  }

  /** Fetch all C3Contracts items, ordered by EndDate ascending. */
  const listContracts = async (): Promise<Contract[]> => {
    const url = `${baseUrl}?$select=*&$top=${PAGE_SIZE}&$orderby=EndDate asc`;
    const contracts = await fetchContracts(url, 'listContracts');
    console.info(`${PREFIX} listContracts: ${contracts.length} contracts`);
    return contracts;
  };

  return {
    listContracts,

    async listRenewalContracts(): Promise<Contract[]> {
      // Inherits fail-closed behaviour: an unavailable contract source rejects
      // here — Renewals renders its error state, never an empty-success view.
      const contracts = await listContracts();
      return contracts.filter(
        c => c.Disposition1 !== 'Terminated' && c.Disposition1 !== 'Archived',
      );
    },

    async getContract(contractId: string): Promise<Contract> {
      const url =
        `${baseUrl}?$select=*&$filter=Title eq '${escOData(contractId)}'&$top=1`;

      // List-read failures (unprovisioned/HTTP/parse/integrity) propagate
      // truthfully; an empty result for a syntactically valid query is a
      // genuine not-found and keeps its own truthful error.
      const contracts = await fetchContracts(url, `getContract(${contractId})`);

      if (contracts.length === 0) {
        throw new Error(`${PREFIX} Contract not found: ${contractId}`);
      }
      return contracts[0];
    },

    async listContractActivities(contractId: string): Promise<Activity[]> {
      void contractId;
      console.warn(
        `${PREFIX} listContractActivities: not implemented in S24. ` +
        'C3ContractActivities list schema is deferred.',
      );
      return [];
    },
  };
};
