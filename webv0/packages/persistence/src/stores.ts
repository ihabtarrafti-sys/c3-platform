/**
 * stores.ts — concrete ReadStore / WriteStore over a pg Pool (as the c3_app
 * role). Implements the @c3web/application Persistence port.
 */
import { Pool } from 'pg';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Actor, Agreement, Apparel, Approval, ApprovalEvent, ApprovalStatus, AuditEvent, Credential, Entity, Journey, Kit, Member, Mission, MissionParticipant, Person } from '@c3web/domain';
import type { Persistence, PersonMissionMembership, ReadStore, WriteStore, WriteTx } from '@c3web/application';
import * as schema from './schema';
import { withTenantTx } from './tenantContext';
import { makeWriteTx } from './writeTx';
import { mapAgreement, mapApparel, mapApproval, mapApprovalEvent, mapAuditEvent, mapCredential, mapEntity, mapJourney, mapKit, mapMission, mapMissionParticipant, mapPerson } from './mappers';

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

        // Sprint 38: equipment reads (drizzle-only).
        listKit: () =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Kit[]> => {
            const rows = await db.select().from(schema.kit).orderBy(asc(schema.kit.kitId));
            return rows.map(mapKit);
          }),

        getKitById: (kitId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Kit | null> => {
            const rows = await db.select().from(schema.kit).where(eq(schema.kit.kitId, kitId)).limit(1);
            return rows[0] ? mapKit(rows[0]) : null;
          }),

        listApparel: () =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Apparel[]> => {
            const rows = await db.select().from(schema.apparel).orderBy(asc(schema.apparel.apparelId));
            return rows.map(mapApparel);
          }),

        getApparelById: (apparelId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Apparel | null> => {
            const rows = await db.select().from(schema.apparel).where(eq(schema.apparel.apparelId, apparelId)).limit(1);
            return rows[0] ? mapApparel(rows[0]) : null;
          }),

        // Sprint 39: missions (shell drizzle-only; participants joined with
        // the person's display name for the register).
        listMissions: () =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Mission[]> => {
            const rows = await db.select().from(schema.mission).orderBy(asc(schema.mission.missionId));
            return rows.map(mapMission);
          }),

        getMissionById: (missionId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Mission | null> => {
            const rows = await db.select().from(schema.mission).where(eq(schema.mission.missionId, missionId)).limit(1);
            return rows[0] ? mapMission(rows[0]) : null;
          }),

        listMissionParticipants: (missionId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<MissionParticipant[]> => {
            const res = await db.execute(sql`
              SELECT mp.*, p.full_name AS person_name
                FROM mission_participant mp
                JOIN person p ON p.tenant_id = mp.tenant_id AND p.person_id = mp.person_id
               WHERE mp.mission_id = ${missionId}
               ORDER BY mp.person_id
            `);
            return res.rows.map(mapMissionParticipant);
          }),

        getMissionParticipant: (missionId: string, personId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<MissionParticipant | null> => {
            const res = await db.execute(sql`
              SELECT mp.*, p.full_name AS person_name
                FROM mission_participant mp
                JOIN person p ON p.tenant_id = mp.tenant_id AND p.person_id = mp.person_id
               WHERE mp.mission_id = ${missionId} AND mp.person_id = ${personId}
            `);
            const row = res.rows[0];
            return row ? mapMissionParticipant(row) : null;
          }),

        // Sprint 41: agreements (drizzle-only; financial omission is the
        // application query layer's job, per-actor).
        listAgreements: () =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Agreement[]> => {
            const rows = await db.select().from(schema.agreement).orderBy(asc(schema.agreement.agreementId));
            return rows.map(mapAgreement);
          }),

        listAgreementsForPerson: (personId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Agreement[]> => {
            const rows = await db
              .select()
              .from(schema.agreement)
              .where(eq(schema.agreement.personId, personId))
              .orderBy(asc(schema.agreement.agreementId));
            return rows.map(mapAgreement);
          }),

        getAgreementById: (agreementId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Agreement | null> => {
            const rows = await db.select().from(schema.agreement).where(eq(schema.agreement.agreementId, agreementId)).limit(1);
            return rows[0] ? mapAgreement(rows[0]) : null;
          }),

        // S48: entities (the tenant's legal operating entities).
        listEntities: () =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Entity[]> => {
            const rows = await db.select().from(schema.entity).orderBy(asc(schema.entity.entityId));
            return rows.map(mapEntity);
          }),

        getEntityById: (entityId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Entity | null> => {
            const rows = await db.select().from(schema.entity).where(eq(schema.entity.entityId, entityId)).limit(1);
            return rows[0] ? mapEntity(rows[0]) : null;
          }),

        // Sprint 42: the person hub — memberships joined with the mission's
        // identity; approvals scoped by the target person column.
        listMissionMembershipsForPerson: (personId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<PersonMissionMembership[]> => {
            const res = await db.execute(sql`
              SELECT mp.mission_id, m.name AS mission_name, m.is_active AS mission_is_active,
                     mp.role, mp.is_active
                FROM mission_participant mp
                JOIN mission m ON m.tenant_id = mp.tenant_id AND m.mission_id = mp.mission_id
               WHERE mp.person_id = ${personId}
               ORDER BY mp.mission_id
            `);
            return (res.rows as Array<{ mission_id: string; mission_name: string; mission_is_active: boolean; role: string; is_active: boolean }>).map((r) => ({
              missionId: r.mission_id,
              missionName: r.mission_name,
              missionIsActive: r.mission_is_active,
              role: r.role,
              isActive: r.is_active,
            }));
          }),

        listApprovalsForPerson: (personId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Approval[]> => {
            const rows = await db
              .select()
              .from(schema.approval)
              .where(eq(schema.approval.targetPersonId, personId))
              .orderBy(desc(schema.approval.approvalId));
            return rows.map(mapApproval);
          }),

        // Sprint 43: the Situation Room bulk participant read (slim; the
        // engine needs ids/roles only, no person-name join).
        listAllMissionParticipants: () =>
          withTenantTx(pool, actor, 'read', async (db) => {
            const rows = await db.select().from(schema.missionParticipant);
            return rows.map((r) => ({ missionId: r.missionId, personId: r.personId, role: r.role, isActive: r.isActive }));
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
