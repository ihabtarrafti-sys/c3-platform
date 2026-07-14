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
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, relative, join } from 'node:path';
import { exitTenant, finalizeTenantExit } from '../src/exitTenant';
import { createBlobReader, sweepTenantBlobErasure } from '../src/blobBundle';
import { validateExitManifest, verifyExitBundle, assertAuthorizingManifestPath, ManifestRejectedError, type ExitBundleReader } from '../src/exitManifest';

/** H-06: a filesystem-backed reader over the export bundle directory. */
function bundleReaderAt(bundleDir: string): ExitBundleReader {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((e) => {
      const full = join(dir, e);
      return statSync(full).isDirectory() ? walk(full) : [relative(bundleDir, full).split('\\').join('/')];
    });
  return {
    async listEntries() {
      return walk(bundleDir).filter((n) => n !== 'manifest.json' && n !== 'manifest.rows-only.json');
    },
    async sha256Of(name) {
      const full = resolve(bundleDir, name);
      try {
        return createHash('sha256').update(readFileSync(full)).digest('hex');
      } catch {
        return null;
      }
    },
    async rowCountOf(name) {
      const full = resolve(bundleDir, name);
      try {
        const text = readFileSync(full, 'utf8');
        if (text.length === 0) return 0;
        return text.replace(/\n$/, '').split('\n').length;
      } catch {
        return null;
      }
    },
  };
}

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

// R2-N01: --finalize <tenant-uuid> is the SEPARATE, explicit point-of-no-return
// invocation (see the data-phase output). When set, we run finalize, not exit.
const finalizeUuid = arg('finalize', false);
// A3 (H-07 tail): the data/sweep path accepts either --tenant-slug or --tenant-id (resume
// by UUID — the slug is resolved from the id after connecting).
let tenantSlug = arg('tenant-slug', false);
const tenantIdArg = arg('tenant-id', false);
const execute = flag('execute');
const confirmSlug = arg('confirm', false);
const manifestPath = arg('manifest', false);
const skipManifest = flag('no-export-bundle');
// H-06: allow a manifest older than the freshness window (explicit override).
const allowStaleManifest = flag('allow-stale-manifest');
// HARDEN-2: erasure includes the OBJECT STORE (keys are tenant-prefixed).
// Executing without storage access refuses unless --leave-blobs says so.
const leaveBlobs = flag('leave-blobs');

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) {
  console.error('DATABASE_ADMIN_URL (privileged admin connection; trigger control needs table ownership) is required.');
  process.exit(2);
}

if (execute && skipManifest) {
  console.error('WARNING: --no-export-bundle set — proceeding WITHOUT verifying a data-return export.');
}
if (execute && !skipManifest && !manifestPath) {
  // Data-return-first: the STRICT content check (H-06) runs after connecting, but
  // the path must be present up front.
  console.error(
    'Execute refused: provide --manifest <path-to-export-manifest.json> proving the org\'s data was exported ' +
      '(export:tenant), or pass --no-export-bundle to explicitly skip the data-return check.',
  );
  process.exit(2);
}

const client = new Client({ connectionString: adminUrl, options: '-c client_encoding=UTF8' });
await client.connect();
// HARDEN-2 blob-erasure preflight: storage access must exist BEFORE the DB
// erasure (after it, the tenant id is the only remaining handle — resolve
// it now, and refuse an execute that would strand objects).
const blobReader = createBlobReader(process.env);
try {
  // A3: resume by UUID — resolve the slug from --tenant-id (the tenant row survives until
  // finalize). The finalize path keys on its own --finalize <uuid> and needs no slug.
  if (!tenantSlug && tenantIdArg) {
    const r = await client.query<{ slug: string }>('SELECT slug FROM tenant WHERE id = $1', [tenantIdArg]);
    if (!r.rows[0]) {
      console.error(`No tenant with id ${tenantIdArg}.`);
      process.exit(2);
    }
    tenantSlug = r.rows[0].slug;
  }
  if (!finalizeUuid && !tenantSlug) {
    console.error('Provide --tenant-slug <slug> (or --tenant-id <uuid> to resume by id).');
    process.exit(2);
  }
  // R2-N01 --finalize: the explicit point-of-no-return. Requires dual slug
  // confirmation (like execute) matching the tenant named by the UUID, then does
  // the fail-closed re-verify + identity removal. No manifest/preflight — the data
  // phase already ran and was verified.
  if (finalizeUuid) {
    const fr = await client.query<{ slug: string }>(`SELECT slug FROM tenant WHERE id = $1`, [finalizeUuid]);
    if (fr.rowCount === 0) {
      console.error(`Finalize refused: no tenant with id ${finalizeUuid} (already finalized, or wrong id).`);
      process.exitCode = 2;
    } else if (confirmSlug !== fr.rows[0]!.slug || process.env.C3_EXIT_SECOND_CONFIRM !== fr.rows[0]!.slug) {
      console.error(`Finalize refused: BOTH confirmations must match the tenant slug '${fr.rows[0]!.slug}' (dual authorization).`);
      process.exitCode = 2;
    } else if (!blobReader) {
      // R4-N02: finalize's re-list is MANDATORY — refuse up front with a clear message rather
      // than letting finalizeTenantExit throw, when no object store is configured.
      console.error(
        'Finalize refused: no blob storage configured (set R2_*/DOCUMENTS_DIR) — finalize MUST re-list both ' +
          'blob prefixes against the live store before removing identity.',
      );
      process.exitCode = 2;
    } else {
      // A4: pass the blob reader so finalize re-lists both prefixes fail-closed — a
      // survivor planted after the last sweep refuses the point-of-no-return.
      const res = await finalizeTenantExit(client, finalizeUuid, blobReader);
      console.log(`\n=== tenant exit FINALIZED: ${fr.rows[0]!.slug} (${finalizeUuid}) ===`);
      console.log(`  identity removed — tenant row, ${res.soleUsers} sole user account(s), and memberships are gone.`);
      console.log('  This is the point of no return; file this in the exit register.');
    }
    await client.end();
    process.exit(process.exitCode ?? 0);
  }

  // H-06: STRICT data-return gate — the manifest must be a well-formed export
  // manifest for THIS live tenant, on the CURRENT schema, and fresh. Rejects
  // hand-written / partial / stale files that a slug-only check would have let
  // authorize an irreversible erasure.
  if (execute && !skipManifest) {
    const tRow = await client.query<{ id: string }>('SELECT id FROM tenant WHERE slug = $1', [tenantSlug]);
    const liveTenantId = tRow.rows[0]?.id;
    if (!liveTenantId) {
      console.error(`Execute refused: unknown tenant '${tenantSlug}'.`);
      process.exit(2);
    }
    const migs = await client.query<{ id: string }>('SELECT id FROM _migrations ORDER BY id');
    // Round-6 §4.2: ONLY the canonical full-export `manifest.json` may authorize — refuse any
    // other filename (e.g. the diagnostic manifest.rows-only.json, renamed or not) BEFORE reading.
    try {
      assertAuthorizingManifestPath(resolve(manifestPath!));
    } catch (err) {
      console.error(`\nEXIT REFUSED (data-return): ${(err as Error).message}`);
      process.exit(2);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(resolve(manifestPath!), 'utf8'));
    } catch (err) {
      console.error(`Execute refused: cannot read manifest at ${manifestPath}: ${(err as Error).message}`);
      process.exit(2);
    }
    try {
      const m = validateExitManifest(raw, {
        tenantSlug: tenantSlug!, // guaranteed present on the data/sweep path (guard above)
        liveTenantId,
        liveMigrations: migs.rows.map((r) => r.id),
        allowStale: allowStaleManifest,
      });
      // H-06: metadata alone cannot authorize — re-open the ACTUAL bundle next to
      // the manifest and verify it matches (exact file set, every hash + row count,
      // every indexed blob present). A fabricated, partial, or --no-doc-bytes
      // bundle is refused HERE, before anything is erased.
      await verifyExitBundle(m, bundleReaderAt(dirname(resolve(manifestPath!))));
      console.log(`  data-return     verified manifest AND bundle for ${m.tenant.slug} (${m.tenant.id}), exported ${m.exportedAt}, ${m.files.length} files + ${m.blobs.length} blobs`);
    } catch (err) {
      if (err instanceof ManifestRejectedError) {
        console.error(`\nEXIT REFUSED (data-return): ${err.message}`);
        process.exit(2);
      }
      throw err;
    }
  }

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
      `  post-checks     zeroRows=${report.postChecks.zeroRowsVerified} tenantExiting=${report.postChecks.tenantExiting} triggersReEnabled=${report.postChecks.triggersReEnabled}`,
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
            'retains the pending keys; re-run this exit (it resumes from the Exiting state) until zero pending and prefixes empty.',
        );
        process.exitCode = 1;
      } else {
        // R2-N01: data erased + object store swept + verified zero. STOP here —
        // the tenant identity is NOT removed automatically. A human re-reads the
        // proof-of-zero and runs the explicit --finalize at the point of no return.
        console.log('\n  DATA erased + object store swept + verified ZERO. The tenant is held in the Exiting state.');
        console.log('  ▶ To remove the identity (IRREVERSIBLE), run the explicit finalize once you have confirmed the above:');
        console.log(
          `      C3_EXIT_SECOND_CONFIRM=${report.tenant.slug} npm run exit:tenant -- ` +
            `--tenant-slug ${report.tenant.slug} --finalize ${report.tenant.id} --confirm ${report.tenant.slug}`,
        );
      }
    } else if (leaveBlobs) {
      console.log('  blobs erased    SKIPPED (--leave-blobs) — object-store residue remains under the tenant prefixes.');
    }
    console.log('\n  File this report in the exit register.');
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
