/**
 * seed-staging.ts — explicit, OWNER-RUN first-tenant seeding (Phase 2B).
 *
 *   npm run seed:staging -- \
 *     --tenant-slug geekay --tenant-name "Geekay Esports" \
 *     --entra-tenant-id <tid-guid> \
 *     --owner-oid <guid> --owner-email owner@geekay.com --owner-name "Ihab Tarrafti" \
 *     --ops-oid <guid>   --ops-email ops@geekay.com     --ops-name "M. Khalailah"
 *
 * Properties (mandated):
 *   - IDEMPOTENT: re-running reconciles to the same state, never duplicates;
 *   - uses ONLY the privileged migration/admin connection (DATABASE_ADMIN_URL);
 *   - creates/reconciles exactly one tenant + two Entra external identities,
 *     assigning owner and operations EXACTLY;
 *   - REFUSES ambiguous duplicate identity bindings (an oid already bound to a
 *     different user, or an email already belonging to a different identity);
 *   - prints a REDACTED reconciliation report (object IDs partially masked);
 *   - is NEVER run automatically — it is a manual CLI, not an API start hook.
 */
import { Client } from 'pg';
import { seedStagingTenant, type SeedSpec } from '../src/seedStaging';

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (!v || v.startsWith('--')) {
    console.error(`Missing required argument --${name}`);
    process.exit(2);
  }
  return v;
}

const spec: SeedSpec = {
  tenantSlug: arg('tenant-slug'),
  tenantName: arg('tenant-name'),
  entraTenantId: arg('entra-tenant-id'),
  owner: { oid: arg('owner-oid'), email: arg('owner-email'), displayName: arg('owner-name') },
  operations: { oid: arg('ops-oid'), email: arg('ops-email'), displayName: arg('ops-name') },
};

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) {
  console.error('DATABASE_ADMIN_URL (privileged migration/admin connection) is required.');
  process.exit(2);
}

const client = new Client({ connectionString: adminUrl, options: '-c client_encoding=UTF8' });
await client.connect();
try {
  const report = await seedStagingTenant(client, spec);
  console.log('\n=== staging seed reconciliation (redacted) ===');
  for (const line of report.lines) console.log(' ', line);
  console.log(report.changed ? '\nSeed applied/reconciled successfully.' : '\nAlready in the desired state (no changes).');
} catch (err) {
  console.error(`\nSEED REFUSED: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
