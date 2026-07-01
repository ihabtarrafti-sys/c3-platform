/**
 * SharePointCredentialService.ts
 *
 * Sprint 15 (S15-3) — SharePoint Credential Integration.
 *
 * Fetches Credential records from the C3Credentials SharePoint list using
 * the native Fetch API. All type-coercion and validation is delegated to
 * spCredentialMapper.ts — this service stays thin.
 *
 * Design principles:
 *   - No PnP.js. Native fetch with Accept: application/json;odata=nometadata.
 *   - credentials: 'same-origin' — relies on the SPFx authentication cookie.
 *   - Fails safely on any error: console.error + empty array/null, never throws.
 *   - listAllCredentials:      $filter=IsActive eq 1, $top=2000
 *   - listCredentialsForPerson: $filter=IsActive eq 1 and HolderPersonID eq '...', $top=2000
 *   - getCredential:            $filter=Title eq '...', $top=1 (no IsActive guard)
 *
 * Sprint 20 Phase 3:
 *   - addCredential: implemented. POST-then-MERGE pattern (SP auto-ID → CRED-XXXX Title).
 *     CredentialType validated against VALID_CREDENTIAL_TYPES before POST.
 *     Throws (not swallows) on write failure — callers (useExecuteApproval) need the error
 *     to stamp the approval ExecutionFailed.
 *
 * OData single-quote escaping: personId / credentialId values are sanitised
 * by doubling any embedded single-quote before interpolation into the filter.
 *
 * See: docs/architecture/C3Credentials SP List Schema.md
 * See: Sprint 15 Proposal §1 (list schema), §6 (HolderPersonID plain text), §8 (logging)
 */

import type { Credential, CreateCredentialInput } from '@c3/types';
import type { ICredentialService } from '../interfaces/ICredentialService';
import {
  mapSpItemsToCredentials,
  mapSpItemToCredential,
  VALID_CREDENTIAL_TYPES,
} from '@c3/utils/spCredentialMapper';
import type { SpCredentialItem } from '@c3/utils/spCredentialMapper';

// ---------------------------------------------------------------------------
// SP REST query constants
// ---------------------------------------------------------------------------

const LIST_NAME       = 'C3Credentials';
const LIST_ITEM_TYPE  = 'SP.Data.C3CredentialsListItem';
const PREFIX          = '[C3/Credential]';

const SELECT_FIELDS = [
  'ID',
  'Title',
  'HolderPersonID',
  'CredentialType',
  'ReferenceNumber',
  'IssuedBy',
  'IssuedDate',
  'ExpiryDate',
  'ValidFromDate',
  'SubType',
  'Notes',
  'IsActive',
  'SupersedesCredentialID',
].join(',');

const PAGE_SIZE = 2000;

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

/** Escape embedded single-quotes for OData $filter string literals. */
function escOData(val: string): string {
  return val.replace(/'/g, "''");
}

function formatCredentialId(n: number): string {
  return `CRED-${String(n).padStart(4, '0')}`;
}

interface SpListResponse {
  value: SpCredentialItem[];
}

/**
 * Fetch SP list items from the given URL.
 * Returns an empty array on any network, HTTP, or parse error (fail-safe).
 */
async function fetchItems(url: string): Promise<SpCredentialItem[]> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json;odata=nometadata' },
    });
  } catch (err) {
    console.error(`${PREFIX} Network error reaching SharePoint:`, err);
    return [];
  }

  if (!response.ok) {
    console.error(
      `${PREFIX} SharePoint returned HTTP ${response.status} ${response.statusText} ` +
      `for list query. Returning empty credential list.`,
    );
    return [];
  }

  let json: SpListResponse;
  try {
    json = (await response.json()) as SpListResponse;
  } catch (err) {
    console.error(`${PREFIX} Failed to parse SharePoint JSON response:`, err);
    return [];
  }

  if (!Array.isArray(json.value)) {
    console.error(
      `${PREFIX} SharePoint response is missing the "value" array. ` +
      'Response shape is unexpected — check list REST endpoint and $select.',
    );
    return [];
  }

  return json.value;
}

/**
 * Fetch a fresh Form Digest Value for write operations.
 * Never cache -- digest TTL is 30 minutes.
 * Throws on failure (write callers must propagate so the stamp can mark ExecutionFailed).
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
 * MERGE a freshly-created C3Credentials item to replace its placeholder Title
 * with the canonical CRED-XXXX identifier derived from the SP item ID.
 * Fetches a fresh digest — the POST digest is consumed.
 * Throws with orphan-row context if the MERGE fails.
 */
async function mergeCredentialTitle(siteUrl: string, id: number, title: string): Promise<void> {
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
    body: JSON.stringify({ __metadata: { type: LIST_ITEM_TYPE }, Title: title }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '(unreadable)');
    throw new Error(
      `${PREFIX} mergeCredentialTitle(${id}): HTTP ${response.status} ${response.statusText}. Body: ${errorText}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createSharePointCredentialService = (siteUrl: string): ICredentialService => {
  const baseUrl = buildListUrl(siteUrl);

  return {
    // ── listAllCredentials ──────────────────────────────────────────────────
    async listAllCredentials(): Promise<Credential[]> {
      const url =
        `${baseUrl}` +
        `?$select=${SELECT_FIELDS}` +
        `&$filter=IsActive eq 1` +
        `&$top=${PAGE_SIZE}`;

      const items = await fetchItems(url);
      const { credentials } = mapSpItemsToCredentials(items);
      return credentials;
    },

    // ── listCredentialsForPerson ────────────────────────────────────────────
    async listCredentialsForPerson(personId: string): Promise<Credential[]> {
      const url =
        `${baseUrl}` +
        `?$select=${SELECT_FIELDS}` +
        `&$filter=IsActive eq 1 and HolderPersonID eq '${escOData(personId)}'` +
        `&$top=${PAGE_SIZE}`;

      const items = await fetchItems(url);
      const { credentials } = mapSpItemsToCredentials(items);
      return credentials;
    },

    // ── getCredential ───────────────────────────────────────────────────────
    // Uses Title (= CredentialID) as the lookup key. No IsActive guard —
    // the caller may need to retrieve a superseded credential for audit.
    async getCredential(credentialId: string): Promise<Credential> {
      const url =
        `${baseUrl}` +
        `?$select=${SELECT_FIELDS}` +
        `&$filter=Title eq '${escOData(credentialId)}'` +
        `&$top=1`;

      const items = await fetchItems(url);

      if (items.length === 0) {
        console.warn(
          `${PREFIX} getCredential: no SP record found for CredentialID "${credentialId}".`,
        );
        return null as unknown as Credential;
      }

      const warnRef = { count: 0 };
      const mapped = mapSpItemToCredential(items[0], warnRef);

      if (mapped === null) {
        // Hard reject: missing HolderPersonID on a direct-lookup record is unusual.
        console.error(
          `${PREFIX} getCredential: SP record for "${credentialId}" was rejected ` +
          `by the mapper (missing HolderPersonID). ` +
          `This record is in the list but cannot be attributed to a Person.`,
        );
        return null as unknown as Credential;
      }

      return mapped;
    },

    // ── addCredential ───────────────────────────────────────────────────────
    //
    // Sprint 20 Phase 3 — governed write path.
    // Called by useExecuteApproval after an AddCredential approval is Approved.
    // Follows POST-then-MERGE pattern (same as initiateJourney + createApproval).
    //
    // Sequence:
    //   1. Validate CredentialType — throw before SP if invalid (avoids HTTP 400).
    //   2. Fetch X-RequestDigest.
    //   3. POST to C3Credentials with placeholder Title (TMP-<timestamp>).
    //   4. Read SP integer ID from POST response.
    //   5. MERGE Title to CRED-XXXX using the SP item ID.
    //   6. GET item by SP ID to read back the created record.
    //   7. Map and return.
    //
    // Error behaviour: throws on any step failure — does NOT swallow errors.
    // The caller (useExecuteApproval) catches and stamps ExecutionFailed.
    //
    // CredentialType validation: input.Type is typed as CredentialType by the
    // interface but the SP list enforces its own choice constraint. Validating
    // here surfaces a clear error before SP returns an opaque HTTP 400.
    async addCredential(input: CreateCredentialInput): Promise<Credential> {
      // ── Step 1: CredentialType pre-validation ──────────────────────────────
      if (!VALID_CREDENTIAL_TYPES.has(input.Type)) {
        throw new Error(
          `${PREFIX} addCredential: CredentialType '${input.Type}' is not in the valid set. ` +
          `SP would reject this POST with HTTP 400. ` +
          `Valid values: ${[...VALID_CREDENTIAL_TYPES].join(', ')}.`,
        );
      }

      // ── Step 2: Fetch digest ───────────────────────────────────────────────
      const digest = await fetchFormDigest(siteUrl);
      const placeholder = 'TMP-' + Date.now().toString(36);

      // ── Step 3: POST ───────────────────────────────────────────────────────
      const postBody = {
        __metadata:             { type: LIST_ITEM_TYPE },
        Title:                  placeholder,
        HolderPersonID:         input.HolderPersonID,
        CredentialType:         input.Type,
        ReferenceNumber:        input.ReferenceNumber,
        IssuedBy:               input.IssuedBy               ?? null,
        IssuedDate:             input.IssuedDate              ?? null,
        ExpiryDate:             input.ExpiryDate              ?? null,
        ValidFromDate:          input.ValidFromDate           ?? null,
        SubType:                input.SubType                 ?? null,
        Notes:                  input.Notes                   ?? null,
        IsActive:               true,
        SupersedesCredentialID: input.SupersedesCredentialID ?? null,
      };

      const postResponse = await fetch(buildListUrl(siteUrl), {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Accept':          'application/json;odata=nometadata',
          'Content-Type':    'application/json;odata=verbose',
          'X-RequestDigest': digest,
        },
        body: JSON.stringify(postBody),
      });

      if (!postResponse.ok) {
        const errorText = await postResponse.text().catch(() => '(unreadable)');
        throw new Error(
          `${PREFIX} addCredential: POST failed with HTTP ${postResponse.status} ` +
          `${postResponse.statusText}. Body: ${errorText}`,
        );
      }

      // ── Step 4: Extract SP integer ID ─────────────────────────────────────
      const created = (await postResponse.json()) as { ID?: number };
      if (typeof created.ID !== 'number') {
        throw new Error(
          `${PREFIX} addCredential: SP did not return an item ID after POST. ` +
          `Cannot derive CRED sequence. An orphaned row with Title '${placeholder}' ` +
          `may exist in ${LIST_NAME}.`,
        );
      }

      const credentialId = formatCredentialId(created.ID);

      // ── Step 5: MERGE canonical Title ─────────────────────────────────────
      try {
        await mergeCredentialTitle(siteUrl, created.ID, credentialId);
      } catch (mergeErr) {
        throw new Error(
          `${PREFIX} addCredential: POST succeeded (SP ID ${created.ID}) but Title MERGE failed. ` +
          `An orphaned row with Title '${placeholder}' exists in ${LIST_NAME}. ` +
          `Original error: ${mergeErr instanceof Error ? mergeErr.message : String(mergeErr)}`,
        );
      }

      // ── Step 6: GET back the created item by SP item ID ────────────────────
      const getUrl =
        `${buildItemUrl(siteUrl, created.ID)}` +
        `?$select=${SELECT_FIELDS}`;

      const getResponse = await fetch(getUrl, {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json;odata=nometadata' },
      });

      if (!getResponse.ok) {
        throw new Error(
          `${PREFIX} addCredential: POST+MERGE succeeded (${credentialId}) but ` +
          `read-back GET failed with HTTP ${getResponse.status}. ` +
          `The credential row exists in SP — check ${credentialId} directly.`,
        );
      }

      // ── Step 7: Map and return ─────────────────────────────────────────────
      const rawItem = (await getResponse.json()) as SpCredentialItem;
      const warnRef = { count: 0 };
      const mapped = mapSpItemToCredential(rawItem, warnRef);

      if (mapped === null) {
        // The row exists but the mapper rejected it — should never happen immediately
        // after we just wrote it. Log and return a minimal synthetic Credential.
        console.error(
          `${PREFIX} addCredential: mapper rejected newly-created row ${credentialId}. ` +
          `HolderPersonID may be missing. Row exists in SP.`,
        );
        throw new Error(
          `${PREFIX} addCredential: ${credentialId} was created in SP but mapper rejected it. ` +
          `Check the row directly for data integrity issues.`,
        );
      }

      console.info(
        `${PREFIX} addCredential: created ${credentialId} ` +
        `(Type: ${input.Type}, Holder: ${input.HolderPersonID}, SP ID: ${created.ID})`,
      );

      return mapped;
    },

    // ── deactivateCredential (stub) ─────────────────────────────────────────
    async deactivateCredential(_credentialId: string): Promise<void> {
      console.warn(
        `${PREFIX} deactivateCredential: write operations are not implemented in S15.`,
      );
    },
  };
};
