/**
 * export-tenant.ts (CLI) — OWNER-RUN organization-scoped export (Track A, B-5).
 *
 *   npm run export:tenant -- --tenant-slug <slug> --out <dir>
 *
 * Properties (mandated):
 *   - READ ONLY: every read runs in a REPEATABLE READ, READ ONLY snapshot; the
 *     process cannot mutate data even in principle;
 *   - uses the privileged connection (DATABASE_EXPORT_URL if set — intended for
 *     the read-only c3_backup role — otherwise DATABASE_ADMIN_URL);
 *   - emits one JSONL file per table + manifest.json (per-file SHA-256, row
 *     counts, tenant id/slug, timestamp, applied schema version);
 *   - HARDEN-2 (M-07/H-03 follow-up): DOCUMENT BYTES ride along under
 *     out/documents/, each verified against its stored SHA-256. When documents
 *     exist but no blob storage is configured (R2_* or DOCUMENTS_DIR), the
 *     export REFUSES — pass the self-describing --no-doc-bytes to skip;
 *   - REFUSES an unknown tenant slug (non-zero exit);
 *   - is NEVER run automatically — a manual operator CLI, not an API hook.
 */
import { Client } from 'pg';
import { resolve } from 'node:path';
import { exportTenant } from '../src/exportTenant';
import { createBlobReader } from '../src/blobBundle';
import { writeAndVerifyExportBundle } from '../src/exportBundle';

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (!v || v.startsWith('--')) {
    console.error(`Missing required argument --${name}`);
    process.exit(2);
  }
  return v;
}

const tenantSlug = arg('tenant-slug');
const outDir = resolve(arg('out'));
const skipDocBytes = process.argv.includes('--no-doc-bytes');

const url = process.env.DATABASE_EXPORT_URL ?? process.env.DATABASE_ADMIN_URL;
if (!url) {
  console.error('DATABASE_EXPORT_URL or DATABASE_ADMIN_URL (a privileged read connection) is required.');
  process.exit(2);
}

const client = new Client({ connectionString: url, options: '-c client_encoding=UTF8' });
await client.connect();
try {
  const result = await exportTenant(client, { tenantSlug });
  // A2 (R3-N01): write the row files + FULL blob universe + prefix-discovered orphans
  // (indexed in the manifest as class 'orphan'), publish the superset manifest last by
  // atomic rename, and RE-VERIFY the written bundle against the strict exit verifier — so
  // the export can never publish a manifest the exit gate would reject. Fail-closed:
  // objects without storage access refuse unless --no-doc-bytes says so out loud.
  const reader = skipDocBytes ? null : createBlobReader(process.env);
  let written;
  try {
    written = await writeAndVerifyExportBundle(outDir, result, reader, { skipDocBytes });
  } catch (err) {
    console.error(`\n${(err as Error).message}`);
    process.exit(1);
  } finally {
    reader?.close();
  }
  const manifest = written.manifest;
  if (skipDocBytes && result.blobs.length > 0) {
    console.error(`WARNING: --no-doc-bytes set — ${result.blobs.length} object blob(s) NOT included in this bundle.`);
  } else if (!skipDocBytes) {
    console.log(`  blobs         ${written.blobCount} DB-named + ${written.orphanCount} orphan object(s), bundle re-verified against the strict exit verifier`);
  }

  console.log(`\n=== tenant export: ${manifest.tenant.slug} (${manifest.tenant.name}) ===`);
  console.log(`  tenant id     ${manifest.tenant.id}`);
  console.log(`  exported at   ${manifest.exportedAt}`);
  console.log(`  schema        ${manifest.schemaVersion.length} migrations (…${manifest.schemaVersion.at(-1)})`);
  console.log(`  out           ${outDir}`);
  let total = 0;
  for (const f of manifest.files) {
    total += f.rows;
    console.log(`    ${f.name.padEnd(24)} ${String(f.rows).padStart(6)} rows  sha256:${f.sha256.slice(0, 12)}…`);
  }
  console.log(`  ${String(total).padStart(6)} rows total across ${manifest.files.length} tables + manifest.json`);
} catch (err) {
  console.error(`\nEXPORT REFUSED: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
