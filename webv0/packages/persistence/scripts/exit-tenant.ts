/**
 * exit-tenant.ts (CLI) — OWNER-RUN Phase-E2 tenant erasure ceremony (B-5 item 3).
 *
 *   Dry-run (default, cannot mutate):
 *     npm run exit:tenant -- --tenant-slug <slug>
 *
 *   Execute (the ceremony):
 *     C3_EXIT_SECOND_CONFIRM=<slug> npm run exit:tenant -- \
 *       --tenant-slug <slug> --execute --confirm <slug> --manifest <path>
 *
 * Guardrails (mandated by docs/design/B5-org-scoped-export-and-exit.md §2):
 *   - DRY-RUN by default; execute is opt-in and loud;
 *   - DUAL AUTHORIZATION: --confirm typed by the requester AND
 *     C3_EXIT_SECOND_CONFIRM typed by the second authorizer, both = slug;
 *   - DATA RETURN FIRST: --manifest must point at an export:tenant
 *     manifest.json for the SAME tenant (slug + tenant id verified) — the org's
 *     data must have been exported before it can be erased. Skipping requires
 *     the explicit, self-describing --no-export-bundle flag;
 *   - E1 BEFORE E2: refuses while any active user still holds a membership;
 *   - single transaction, in-tx zero-row post-checks, append-only triggers
 *     re-enabled or everything rolls back;
 *   - prints the reconciliation report — file it in the exit register. The
 *     report is the retained record OF the erasure, not the erased data.
 *
 * Uses ONLY the privileged admin connection (DATABASE_ADMIN_URL): disabling
 * the append-only triggers requires table ownership. Never an API hook.
 */
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exitTenant } from '../src/exitTenant';
import { createBlobReader, sweepTenantBlobErasure } from '../src/blobBundle';

function arg(name: string, required: boolean): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (required && (!v || v.startsWith('--'))) {
    console.error(`Missing required argument --${name}`);
    process.exit(2);
  }
  return v && !v.startsWith('--') ? v : undefined;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

const tenantSlug = arg('tenant-slug', true)!;
const execute = flag('execute');
const confirmSlug = arg('confirm', false);
const manifestPath = arg('manifest', false);
const skipManifest = flag('no-export-bundle');
// HARDEN-2: erasure includes the OBJECT STORE (keys are tenant-prefixed).
// Executing without storage access refuses unless --leave-blobs says so.
const leaveBlobs = flag('leave-blobs');

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) {
  console.error('DATABASE_ADMIN_URL (privileged admin connection; trigger control needs table ownership) is required.');
  process.exit(2);
}

if (execute) {
  // Data-return-first: verify the export bundle before anything irreversible.
  if (!skipManifest) {
    if (!manifestPath) {
      console.error(
        'Execute refused: provide --manifest <path-to-export-manifest.json> proving the org\'s data was exported ' +
          '(export:tenant), or pass --no-export-bundle to explicitly skip the data-return check.',
      );
      process.exit(2);
    }
    let manifest: { tenant?: { slug?: string } };
    try {
      manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'));
    } catch (err) {
      console.error(`Execute refused: cannot read manifest at ${manifestPath}: ${(err as Error).message}`);
      process.exit(2);
    }
    if (manifest.tenant?.slug !== tenantSlug) {
      console.error(
        `Execute refused: manifest is for tenant '${manifest.tenant?.slug ?? 'unknown'}', not '${tenantSlug}'.`,
      );
      process.exit(2);
    }
  } else {
    console.error('WARNING: --no-export-bundle set — proceeding WITHOUT verifying a data-return export.');
  }
}

const client = new Client({ connectionString: adminUrl, options: '-c client_encoding=UTF8' });
await client.connect();
// HARDEN-2 blob-erasure preflight: storage access must exist BEFORE the DB
// erasure (after it, the tenant id is the only remaining handle — resolve
// it now, and refuse an execute that would strand objects).
const blobReader = createBlobReader(process.env);
try {
  let blobTenantId: string | null = null;
  if (execute && !leaveBlobs) {
    const t = await client.query<{ id: string }>('SELECT id FROM tenant WHERE slug = $1', [tenantSlug]);
    blobTenantId = t.rows[0]?.id ?? null;
    if (blobTenantId && !blobReader) {
      // H-07: count the WHOLE blob universe, not documents only — a photo-only
      // or intake-only tenant would otherwise pass this preflight and strand
      // its bytes.
      const objs = await client.query<{ n: string }>(
        `SELECT (SELECT count(*) FROM document WHERE tenant_id = $1)
              + (SELECT count(*) FROM person WHERE tenant_id = $1 AND photo_storage_key IS NOT NULL)
              + (SELECT count(*) FROM intake_submission WHERE tenant_id = $1 AND status = 'Pending' AND uploads <> '[]'::jsonb) AS n`,
        [blobTenantId],
      );
      if (Number(objs.rows[0]?.n ?? 0) > 0) {
        console.error(
          '\nEXIT REFUSED: the tenant has storage objects (documents, photos, and/or intake quarantine) but no blob ' +
            'storage is configured (set R2_* or DOCUMENTS_DIR so the objects can be erased, or pass --leave-blobs to explicitly strand them).',
        );
        process.exit(2);
      }
    }
  }

  const report = await exitTenant(client, {
    tenantSlug,
    execute,
    confirmSlug,
    secondConfirm: process.env.C3_EXIT_SECOND_CONFIRM,
  });

  console.log(`\n=== tenant exit ${report.mode === 'executed' ? 'EXECUTED' : 'DRY-RUN'}: ${report.tenant.slug} (${report.tenant.name}) ===`);
  console.log(`  tenant id       ${report.tenant.id}`);
  console.log(`  active members  ${report.activeMembers}${report.activeMembers > 0 ? '  ← BLOCKS execute (complete Phase E1 first)' : ''}`);
  console.log(`  sole users      ${report.soleUsers} (erased with the org)`);
  console.log(`  shared users    ${report.sharedUsers} (preserved — members of another tenant)`);
  for (const t of report.tables) {
    console.log(`    ${t.name.padEnd(24)} ${String(t.rows).padStart(6)} rows ${report.mode === 'executed' ? 'erased' : 'would be erased'}`);
  }
  if (report.postChecks) {
    console.log(
      `  post-checks     zeroRows=${report.postChecks.zeroRowsVerified} tenantRowGone=${report.postChecks.tenantRowGone} triggersReEnabled=${report.postChecks.triggersReEnabled}`,
    );
    // HARDEN-3 (H-07) Phase 2: erase the object store under BOTH tenant prefixes
    // (${tenantId}/ + intake/${tenantId}/, orphans included) and VERIFY every
    // recorded exit tombstone's object is gone. The tombstone ledger (written in
    // the committed transaction above) is the durable, retryable record.
    if (!leaveBlobs && blobReader && blobTenantId) {
      const sweep = await sweepTenantBlobErasure(client, blobReader, blobTenantId);
      console.log(
        `  blobs erased    ${sweep.deletedObjects.length} object(s); tombstones verified ${sweep.verifiedTombstones}` +
          `${sweep.pendingTombstones > 0 ? `, PENDING ${sweep.pendingTombstones}` : ''}; prefixes empty: ${sweep.prefixesEmpty}`,
      );
      if (sweep.pendingTombstones > 0 || !sweep.prefixesEmpty) {
        console.error(
          '  ⚠ BLOB ERASURE INCOMPLETE — some objects were not confirmed deleted. The blob_tombstone ledger ' +
            'retains the pending keys; re-run the exit blob sweep until it reports zero pending and prefixes empty.',
        );
        process.exitCode = 1;
      }
    } else if (leaveBlobs) {
      console.log('  blobs erased    SKIPPED (--leave-blobs) — object-store residue remains under the tenant prefixes.');
    }
    console.log('\n  Erasure committed. File this report in the exit register.');
    console.log('  Residual: encrypted backups retain this data until lifecycle expiry (max 180d);');
    console.log('  any post-exit restore MUST re-apply this erasure (see B5 design §3).');
  } else if (report.activeMembers === 0) {
    console.log('\n  Dry-run only — nothing was changed. To execute, see the ceremony header of this script.');
  }
} catch (err) {
  console.error(`\nEXIT REFUSED: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  blobReader?.close();
  await client.end();
}
