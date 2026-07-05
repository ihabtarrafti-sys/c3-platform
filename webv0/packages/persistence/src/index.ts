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
export * as schema from './schema';
