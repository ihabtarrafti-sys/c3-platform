/**
 * @c3web/persistence — PostgreSQL adapter (Drizzle ORM) implementing the
 * @c3web/application Persistence port. Tenant isolation is enforced at the
 * application layer (per-transaction `app.tenant_id`) with RLS as defense in
 * depth. The API connects only as the least-privileged c3_app role.
 */
export { createPersistence } from './stores';
export type { PersistenceConfig, PersistenceHandle } from './stores';
export { runMigrations } from './migrate';
export type { MigrateConfig } from './migrate';
export { exportTenant } from './exportTenant';
export type { ExportSpec, ExportResult, ExportManifest, ExportedFile, ManifestBlob } from './exportTenant';
export { enumerateTenantBlobs, tenantBlobPrefixes } from './blobUniverse';
export type { BlobClass, BlobDescriptor } from './blobUniverse';
export { exitTenant } from './exitTenant';
export type { ExitOptions, ExitReport } from './exitTenant';
export * as schema from './schema';
