/**
 * SharePointContractService.ts
 *
 * Sprint 24 Phase 1 — Rewritten with native fetch.
 *
 * Replaces the legacy PnP.js implementation (TD-04, resolved S24-P1).
 * Targets: C3Contracts SP list (not legacy C3_Contracts).
 *
 * Design follows the S15-S23 native-fetch service pattern:
 *   - No @pnp/sp. No spfi. No SPFI.
 *   - credentials: 'same-origin' — relies on SPFx auth cookie.
 *   - Accept: application/json;odata=nometadata — flat JSON, no OData envelope.
 *   - Read-only in Sprint 24. No request digest required.
 *   - Fails safely: console.error + empty array on HTTP / parse errors.
 *
 * See: docs/architecture/C3Contracts SP List Schema.md
 * See: docs/architecture/C3 Tech Debt Register.md (TD-04 resolved)
 */

import { mapContract, type SPContractItem } from '@c3/mappers';
import type { Activity, Contract } from '@c3/types';
import type { IContractService } from '../interfaces/IContractService';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

interface SpListResponse {
  value: SPContractItem[];
}

/**
 * Fetch SP list items from the given URL.
 * Returns an empty array on any network, HTTP, or parse error (fail-safe).
 */
async function fetchContractItems(url: string): Promise<SPContractItem[]> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json;odata=nometadata' },
    });
  } catch (err) {
    console.error('[C3/Contracts] Network error reaching SharePoint:', err);
    return [];
  }

  if (!response.ok) {
    if (response.status === 404) {
      console.warn(
        '[C3/Contracts] C3Contracts list not found (HTTP 404). ' +
        'The list may not be provisioned yet. ' +
        'See docs/architecture/C3Contracts SP List Schema.md for provisioning steps.',
      );
    } else {
      console.error(
        `[C3/Contracts] SharePoint returned HTTP ${response.status} ${response.statusText} ` +
        'for C3Contracts query. Returning empty contract list.',
      );
    }
    return [];
  }

  let json: SpListResponse;
  try {
    json = (await response.json()) as SpListResponse;
  } catch (err) {
    console.error('[C3/Contracts] Failed to parse SharePoint JSON response:', err);
    return [];
  }

  if (!Array.isArray(json.value)) {
    console.error(
      '[C3/Contracts] SharePoint response is missing the "value" array. ' +
      'Check C3Contracts list REST endpoint and $select.',
    );
    return [];
  }

  return json.value;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createSharePointContractService = (
  siteUrl: string,
): IContractService => {
  const baseUrl = buildListUrl(siteUrl);

  /** Fetch all C3Contracts items, ordered by EndDate ascending. */
  const listContracts = async (): Promise<Contract[]> => {
    const url =
      `${baseUrl}` +
      `?$select=*` +
      `&$top=${PAGE_SIZE}` +
      `&$orderby=EndDate asc`;

    const items = await fetchContractItems(url);
    return items.map(mapContract);
  };

  return {
    listContracts,

    async listRenewalContracts(): Promise<Contract[]> {
      const contracts = await listContracts();
      return contracts.filter(
        c => c.Disposition1 !== 'Terminated' && c.Disposition1 !== 'Archived',
      );
    },

    async getContract(contractId: string): Promise<Contract> {
      const url =
        `${baseUrl}` +
        `?$select=*` +
        `&$filter=Title eq '${escOData(contractId)}'` +
        `&$top=1`;

      const items = await fetchContractItems(url);

      if (items.length === 0) {
        throw new Error(`[C3/Contracts] Contract not found: ${contractId}`);
      }

      return mapContract(items[0]);
    },

    async listContractActivities(contractId: string): Promise<Activity[]> {
      void contractId;
      console.warn(
        '[C3/Contracts] listContractActivities: not implemented in S24. ' +
        'C3ContractActivities list schema is deferred.',
      );
      return [];
    },
  };
};
