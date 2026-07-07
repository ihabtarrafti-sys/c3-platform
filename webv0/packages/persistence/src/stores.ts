/**
 * stores.ts — concrete ReadStore / WriteStore over a pg Pool (as the c3_app
 * role). Implements the @c3web/application Persistence port.
 */
import { Pool } from 'pg';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Actor, Approval, ApprovalEvent, ApprovalStatus, AuditEvent, Credential, Journey, Member, Person } from '@c3web/domain';
import type { Persistence, ReadStore, WriteStore, WriteTx } from '@c3web/application';
import * as schema from './schema';
import { withTenantTx } from './tenantContext';
import { makeWriteTx } from './writeTx';
import { mapApproval, mapApprovalEvent, mapAuditEvent, mapCredential, mapJourney, mapPerson } from './mappers';

export interface PersistenceConfig {
  /** Connection string for the least-privileged application role (c3_app). */
  readonly appConnectionString: string;
  /** Optional pool tuning. */
  readonly max?: number;
}

export interface PersistenceHandle extends Persistence {
  readonly pool: Pool;
  close(): Promise<void>;
}

export function createPersistence(config: PersistenceConfig): PersistenceHandle {
  // Force UTF-8 at connection startup (avoids a racing per-connection SET, and
  // guards against a client locale defaulting to WIN1252 on Windows).
  const pool = new Pool({
    connectionString: config.appConnectionString,
    max: config.max ?? 10,
    options: '-c client_encoding=UTF8',
  });

  const reads = {
    forActor(actor: Actor): ReadStore {
      return {
        listPeople: () =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Person[]> => {
            const rows = await db.select().from(schema.person).orderBy(asc(schema.person.personId));
            return rows.map(mapPerson);
          }),

        getPersonById: (personId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Person | null> => {
            const rows = await db.select().from(schema.person).where(eq(schema.person.personId, personId)).limit(1);
            return rows[0] ? mapPerson(rows[0]) : null;
          }),

        listApprovals: (filter?: { statuses?: ApprovalStatus[] }) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Approval[]> => {
            const base = db.select().from(schema.approval);
            const rows = filter?.statuses?.length
              ? await base.where(inArray(schema.approval.status, filter.statuses)).orderBy(desc(schema.approval.approvalId))
              : await base.orderBy(desc(schema.approval.approvalId));
            return rows.map(mapApproval);
          }),

        getApprovalById: (approvalId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Approval | null> => {
            const rows = await db
              .select()
              .from(schema.approval)
              .where(eq(schema.approval.approvalId, approvalId))
              .limit(1);
            return rows[0] ? mapApproval(rows[0]) : null;
          }),

        listApprovalEvents: (approvalId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<ApprovalEvent[]> => {
            const rows = await db
              .select()
              .from(schema.approvalEvent)
              .where(eq(schema.approvalEvent.approvalId, approvalId))
              .orderBy(asc(schema.approvalEvent.at));
            return rows.map(mapApprovalEvent);
          }),

        listAuditEventsForEntity: (entityType: string, entityId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<AuditEvent[]> => {
            const rows = await db
              .select()
              .from(schema.auditEvent)
              .where(and(eq(schema.auditEvent.entityType, entityType), eq(schema.auditEvent.entityId, entityId)))
              .orderBy(asc(schema.auditEvent.at));
            return rows.map(mapAuditEvent);
          }),

        // Sprint 36: credentials — drizzle-only reads (mode:'string' dates).
        listCredentials: () =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Credential[]> => {
            const rows = await db.select().from(schema.credential).orderBy(asc(schema.credential.credentialId));
            return rows.map(mapCredential);
          }),

        listCredentialsForPerson: (personId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Credential[]> => {
            const rows = await db
              .select()
              .from(schema.credential)
              .where(eq(schema.credential.personId, personId))
              .orderBy(asc(schema.credential.credentialId));
            return rows.map(mapCredential);
          }),

        getCredentialById: (credentialId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Credential | null> => {
            const rows = await db
              .select()
              .from(schema.credential)
              .where(eq(schema.credential.credentialId, credentialId))
              .limit(1);
            return rows[0] ? mapCredential(rows[0]) : null;
          }),

        // Sprint 37: journeys — drizzle-only reads (mode:'string' dates).
        listJourneys: () =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Journey[]> => {
            const rows = await db.select().from(schema.journey).orderBy(asc(schema.journey.journeyId));
            return rows.map(mapJourney);
          }),

        listJourneysForPerson: (personId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Journey[]> => {
            const rows = await db
              .select()
              .from(schema.journey)
              .where(eq(schema.journey.personId, personId))
              .orderBy(asc(schema.journey.journeyId));
            return rows.map(mapJourney);
          }),

        getJourneyById: (journeyId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Journey | null> => {
            const rows = await db.select().from(schema.journey).where(eq(schema.journey.journeyId, journeyId)).limit(1);
            return rows[0] ? mapJourney(rows[0]) : null;
          }),

        // Sprint 35: the member directory is read through the tenant-scoped
        // member_list() SECURITY DEFINER gateway — c3_app has no table access.
        listMembers: () =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Member[]> => {
            const res = await db.execute(sql`SELECT * FROM member_list()`);
            return (res.rows as Array<{ user_id: string; email: string; display_name: string; role: string; is_active: boolean; created_at: Date | string }>).map((r) => ({
              userId: r.user_id,
              tenantId: actor.tenantId,
              email: r.email,
              displayName: r.display_name,
              role: r.role as Member['role'],
              isActive: r.is_active,
              createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
            }));
          }),
      };
    },
  };

  const writes: WriteStore = {
    transaction<T>(actor: Actor, fn: (tx: WriteTx) => Promise<T>): Promise<T> {
      return withTenantTx(pool, actor, 'write', async (db) => {
        const tx = makeWriteTx(db, actor);
        return fn(tx);
      });
    },
  };

  return {
    reads,
    writes,
    pool,
    close: () => pool.end(),
  };
}
