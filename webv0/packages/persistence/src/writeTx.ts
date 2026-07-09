/**
 * writeTx.ts — WriteTx implementation bound to a single tenant transaction.
 * All statements run under the transaction's `app.tenant_id` (RLS enforced).
 */
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import {
  type Agreement,
  ConflictError,
  IdentityAlreadyBoundError,
  LastOwnerProtectionError,
  NotFoundError,
  SelfAdministrationError,
  TenantContextMissingError,
  type Actor,
  type Apparel,
  type Approval,
  type C3Role,
  type Credential,
  type Entity,
  type Journey,
  type JourneyStatus,
  type Kit,
  type Member,
  type Mission,
  type MissionParticipant,
  type Person,
} from '@c3web/domain';
import type { AgreementPatch, EntityPatch, EquipmentPatch, MissionPatch, NewAgreementRow, NewApprovalRow, NewCredentialRow, NewEntityRow, NewEquipmentRow, NewJourneyRow, NewMissionRow, NewPersonRow, WriteTx } from '@c3web/application';
import type { Db } from './tenantContext';
import * as schema from './schema';
import { mapAgreement, mapApparel, mapApproval, mapCredential, mapEntity, mapJourney, mapKit, mapMission, mapMissionParticipant, mapPerson } from './mappers';

/**
 * Map a member-gateway failure (SECURITY DEFINER function, message prefixed
 * 'C3E:<CODE>:') to the domain error taxonomy. Non-gateway errors re-throw.
 * The driver/ORM may WRAP the pg error (drizzle puts it in `cause`), so the
 * prefix is searched across the whole cause chain.
 */
function gatewayMessage(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur; i++) {
    if (cur instanceof Error) {
      parts.push(cur.message);
      cur = (cur as { cause?: unknown }).cause;
    } else {
      parts.push(String(cur));
      break;
    }
  }
  return parts.join(' | ');
}

function mapMemberGatewayError(err: unknown, action: string): never {
  const msg = gatewayMessage(err);
  const m = /C3E:([A-Z_]+):/.exec(msg);
  if (m) {
    switch (m[1]) {
      case 'TENANT_CONTEXT_MISSING':
        throw new TenantContextMissingError();
      case 'IDENTITY_ALREADY_BOUND':
        throw new IdentityAlreadyBoundError();
      case 'SELF_ADMINISTRATION_BLOCKED':
        throw new SelfAdministrationError(action);
      case 'LAST_OWNER_PROTECTED':
        throw new LastOwnerProtectionError(action);
      case 'NOT_FOUND':
        throw new NotFoundError('Member', action);
      case 'CONFLICT': {
        const detail = /C3E:CONFLICT:\s*([^|]*)/.exec(msg)?.[1]?.trim();
        throw new ConflictError(detail || 'Member operation conflict.');
      }
    }
  }
  throw err;
}

interface MemberRow {
  user_id: string;
  email: string;
  display_name: string;
  role: string;
  is_active: boolean;
  created_at: Date | string;
}

function mapMember(r: MemberRow, tenantId: string): Member {
  return {
    userId: r.user_id,
    tenantId,
    email: r.email,
    displayName: r.display_name,
    role: r.role as Member['role'],
    isActive: r.is_active,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

export function makeWriteTx(db: Db, actor: Actor): WriteTx {
  const tenantId = actor.tenantId;

  /** Participant domain view: the pair row joined with the person's name. */
  const readParticipantView = async (missionId: string, personId: string, lock = false): Promise<MissionParticipant | null> => {
    const res = await db.execute(sql`
      SELECT mp.*, p.full_name AS person_name
        FROM mission_participant mp
        JOIN person p ON p.tenant_id = mp.tenant_id AND p.person_id = mp.person_id
       WHERE mp.mission_id = ${missionId} AND mp.person_id = ${personId}
       ${lock ? sql`FOR UPDATE OF mp` : sql``}
    `);
    const row = res.rows[0];
    return row ? mapMissionParticipant(row) : null;
  };

  return {
    async allocateSequence(kind) {
      // Atomic, server-controlled. ON CONFLICT DO UPDATE row-locks the counter
      // so concurrent allocations serialise. Never MAX+1.
      const res = await db.execute(sql`
        INSERT INTO business_id_counter (tenant_id, kind, last_value)
        VALUES (${tenantId}, ${kind}, 1)
        ON CONFLICT (tenant_id, kind)
        DO UPDATE SET last_value = business_id_counter.last_value + 1
        RETURNING last_value
      `);
      const row = res.rows[0] as { last_value: string | number } | undefined;
      if (!row) throw new Error('business-ID allocation returned no row');
      return Number(row.last_value);
    },

    async insertApproval(row: NewApprovalRow): Promise<Approval> {
      const [r] = await db
        .insert(schema.approval)
        .values({
          tenantId,
          approvalId: row.approvalId,
          operationType: row.operationType,
          targetPersonId: row.targetPersonId,
          targetId: row.targetId,
          reason: row.reason,
          status: 'Submitted',
          payload: row.payload,
          submittedBy: row.submittedBy,
        })
        .returning();
      return mapApproval(r);
    },

    async lockApproval(approvalId: string): Promise<Approval | null> {
      const res = await db.execute(
        sql`SELECT * FROM approval WHERE approval_id = ${approvalId} FOR UPDATE`,
      );
      const row = res.rows[0];
      return row ? mapApproval(row) : null;
    },

    async updateApprovalStatus(approvalId, expectedVersion, patch): Promise<Approval | null> {
      const sets = [sql`status = ${patch.status}`, sql`version = version + 1`];
      if ('reviewedBy' in patch) sets.push(sql`reviewed_by = ${patch.reviewedBy ?? null}`);
      if ('reviewedAt' in patch) sets.push(sql`reviewed_at = ${patch.reviewedAt ?? null}`);
      if ('rejectionReason' in patch) sets.push(sql`rejection_reason = ${patch.rejectionReason ?? null}`);
      if ('executedAt' in patch) sets.push(sql`executed_at = ${patch.executedAt ?? null}`);
      if ('executionError' in patch) sets.push(sql`execution_error = ${patch.executionError ?? null}`);
      if ('targetPersonId' in patch && patch.targetPersonId !== undefined) {
        sets.push(sql`target_person_id = ${patch.targetPersonId}`);
      }
      const res = await db.execute(sql`
        UPDATE approval SET ${sql.join(sets, sql`, `)}
        WHERE approval_id = ${approvalId} AND version = ${expectedVersion}
        RETURNING *
      `);
      const row = res.rows[0];
      return row ? mapApproval(row) : null;
    },

    async insertPerson(row: NewPersonRow): Promise<Person> {
      const [r] = await db
        .insert(schema.person)
        .values({
          tenantId,
          personId: row.personId,
          fullName: row.fullName,
          ign: row.ign,
          nationality: row.nationality,
          primaryRole: row.primaryRole,
          personnelCode: row.personnelCode,
          currentTeam: row.currentTeam,
          currentGameTitle: row.currentGameTitle,
          primaryDepartment: row.primaryDepartment,
          entityId: row.entityId,
          notes: row.notes,
          createdByApprovalId: row.createdByApprovalId,
        })
        .returning();
      return mapPerson(r);
    },

    async getPersonByCreatingApproval(approvalId: string): Promise<Person | null> {
      const res = await db.execute(
        sql`SELECT * FROM person WHERE created_by_approval_id = ${approvalId}`,
      );
      const row = res.rows[0];
      return row ? mapPerson(row) : null;
    },

    async appendApprovalEvent(evt): Promise<void> {
      await db.insert(schema.approvalEvent).values({
        tenantId,
        approvalId: evt.approvalId,
        fromStatus: evt.fromStatus,
        toStatus: evt.toStatus,
        actor: evt.actor,
        note: evt.note ?? null,
      });
    },

    async appendAuditEvent(evt): Promise<void> {
      await db.insert(schema.auditEvent).values({
        tenantId,
        entityType: evt.entityType,
        entityId: evt.entityId,
        action: evt.action,
        actor: evt.actor,
        before: (evt.before ?? null) as unknown as Record<string, unknown>,
        after: (evt.after ?? null) as unknown as Record<string, unknown>,
      });
    },

    async memberProvision(input): Promise<string> {
      try {
        const res = await db.execute(sql`
          SELECT member_provision(${input.email}, ${input.displayName}, ${input.role},
                                  ${input.provider}, ${input.issuerTenantId}, ${input.subject}) AS user_id
        `);
        return (res.rows[0] as { user_id: string }).user_id;
      } catch (err) {
        mapMemberGatewayError(err, 'ProvisionMember');
      }
    },

    async memberSetRole(userId: string, toRole: C3Role, actorEmail: string): Promise<string> {
      try {
        const res = await db.execute(sql`SELECT member_set_role(${userId}::uuid, ${toRole}, ${actorEmail}) AS prev`);
        return (res.rows[0] as { prev: string }).prev;
      } catch (err) {
        mapMemberGatewayError(err, 'ChangeRole');
      }
    },

    async memberSetActive(userId: string, active: boolean, actorEmail: string): Promise<string> {
      try {
        const res = await db.execute(sql`SELECT member_set_active(${userId}::uuid, ${active}, ${actorEmail}) AS mode`);
        return (res.rows[0] as { mode: string }).mode;
      } catch (err) {
        mapMemberGatewayError(err, active ? 'ReactivateMember' : 'DeactivateMember');
      }
    },

    async getMember(userId: string): Promise<Member | null> {
      const res = await db.execute(sql`SELECT * FROM member_get(${userId}::uuid)`);
      const row = res.rows[0] as MemberRow | undefined;
      return row ? mapMember(row, tenantId) : null;
    },

    // ── Sprint 36 credentials — drizzle-only CRUD (mode:'string' dates; the
    //    node-pg DATE→Date parser must never touch these values).
    async insertCredential(row: NewCredentialRow): Promise<Credential> {
      const [r] = await db
        .insert(schema.credential)
        .values({
          tenantId,
          credentialId: row.credentialId,
          personId: row.personId,
          credentialType: row.credentialType,
          issuer: row.issuer,
          issuedOn: row.issuedOn,
          expiresOn: row.expiresOn,
          notes: row.notes,
          createdByApprovalId: row.createdByApprovalId,
        })
        .returning();
      return mapCredential(r);
    },

    async getCredentialByCreatingApproval(approvalId: string): Promise<Credential | null> {
      const rows = await db
        .select()
        .from(schema.credential)
        .where(eq(schema.credential.createdByApprovalId, approvalId))
        .limit(1);
      return rows[0] ? mapCredential(rows[0]) : null;
    },

    async deactivateCredential(credentialId: string): Promise<Credential | null> {
      const rows = await db
        .update(schema.credential)
        .set({ isActive: false, version: sql`${schema.credential.version} + 1` })
        .where(and(eq(schema.credential.credentialId, credentialId), eq(schema.credential.isActive, true)))
        .returning();
      return rows[0] ? mapCredential(rows[0]) : null;
    },

    // ── Sprint 37 journeys — drizzle-only (mode:'string' dates). ──────────────
    async insertJourney(row: NewJourneyRow): Promise<Journey> {
      const [r] = await db
        .insert(schema.journey)
        .values({
          tenantId,
          journeyId: row.journeyId,
          personId: row.personId,
          journeyType: row.journeyType,
          title: row.title,
          startedOn: row.startedOn,
          notes: row.notes,
          createdByApprovalId: row.createdByApprovalId,
        })
        .returning();
      return mapJourney(r);
    },

    async getJourneyByCreatingApproval(approvalId: string): Promise<Journey | null> {
      const rows = await db
        .select()
        .from(schema.journey)
        .where(eq(schema.journey.createdByApprovalId, approvalId))
        .limit(1);
      return rows[0] ? mapJourney(rows[0]) : null;
    },

    async getJourney(journeyId: string): Promise<Journey | null> {
      const rows = await db.select().from(schema.journey).where(eq(schema.journey.journeyId, journeyId)).limit(1);
      return rows[0] ? mapJourney(rows[0]) : null;
    },

    async transitionJourney(
      journeyId: string,
      expectedVersion: number,
      allowedFrom: readonly JourneyStatus[],
      patch: { status: JourneyStatus; endedOn: string | null },
    ): Promise<Journey | null> {
      const rows = await db
        .update(schema.journey)
        .set({ status: patch.status, endedOn: patch.endedOn, version: sql`${schema.journey.version} + 1` })
        .where(
          and(
            eq(schema.journey.journeyId, journeyId),
            eq(schema.journey.version, expectedVersion),
            inArray(schema.journey.status, [...allowedFrom]),
          ),
        )
        .returning();
      return rows[0] ? mapJourney(rows[0]) : null;
    },

    // ── Sprint 38 equipment (direct CRUD; drizzle-only) ────────────────────────
    async insertKit(kitId: string, row: NewEquipmentRow): Promise<Kit> {
      const [r] = await db.insert(schema.kit).values({ tenantId, kitId, ...row }).returning();
      return mapKit(r);
    },

    async getKit(kitId: string): Promise<Kit | null> {
      const rows = await db.select().from(schema.kit).where(eq(schema.kit.kitId, kitId)).limit(1);
      return rows[0] ? mapKit(rows[0]) : null;
    },

    async updateKit(kitId: string, expectedVersion: number, patch: EquipmentPatch): Promise<Kit | null> {
      const rows = await db
        .update(schema.kit)
        .set({ ...patch, version: sql`${schema.kit.version} + 1` })
        .where(and(eq(schema.kit.kitId, kitId), eq(schema.kit.version, expectedVersion)))
        .returning();
      return rows[0] ? mapKit(rows[0]) : null;
    },

    async deactivateKit(kitId: string, expectedVersion: number): Promise<Kit | null> {
      const rows = await db
        .update(schema.kit)
        .set({ isActive: false, version: sql`${schema.kit.version} + 1` })
        .where(and(eq(schema.kit.kitId, kitId), eq(schema.kit.version, expectedVersion), eq(schema.kit.isActive, true)))
        .returning();
      return rows[0] ? mapKit(rows[0]) : null;
    },

    async setKitStatus(kitId: string, expectedVersion: number, status: string): Promise<Kit | null> {
      const rows = await db
        .update(schema.kit)
        .set({ status, version: sql`${schema.kit.version} + 1` })
        .where(and(eq(schema.kit.kitId, kitId), eq(schema.kit.version, expectedVersion)))
        .returning();
      return rows[0] ? mapKit(rows[0]) : null;
    },

    async insertApparel(apparelId: string, row: NewEquipmentRow): Promise<Apparel> {
      const [r] = await db.insert(schema.apparel).values({ tenantId, apparelId, ...row }).returning();
      return mapApparel(r);
    },

    async getApparel(apparelId: string): Promise<Apparel | null> {
      const rows = await db.select().from(schema.apparel).where(eq(schema.apparel.apparelId, apparelId)).limit(1);
      return rows[0] ? mapApparel(rows[0]) : null;
    },

    async updateApparel(apparelId: string, expectedVersion: number, patch: EquipmentPatch): Promise<Apparel | null> {
      const rows = await db
        .update(schema.apparel)
        .set({ ...patch, version: sql`${schema.apparel.version} + 1` })
        .where(and(eq(schema.apparel.apparelId, apparelId), eq(schema.apparel.version, expectedVersion)))
        .returning();
      return rows[0] ? mapApparel(rows[0]) : null;
    },

    async deactivateApparel(apparelId: string, expectedVersion: number): Promise<Apparel | null> {
      const rows = await db
        .update(schema.apparel)
        .set({ isActive: false, version: sql`${schema.apparel.version} + 1` })
        .where(and(eq(schema.apparel.apparelId, apparelId), eq(schema.apparel.version, expectedVersion), eq(schema.apparel.isActive, true)))
        .returning();
      return rows[0] ? mapApparel(rows[0]) : null;
    },

    async setApparelStatus(apparelId: string, expectedVersion: number, status: string): Promise<Apparel | null> {
      const rows = await db
        .update(schema.apparel)
        .set({ status, version: sql`${schema.apparel.version} + 1` })
        .where(and(eq(schema.apparel.apparelId, apparelId), eq(schema.apparel.version, expectedVersion)))
        .returning();
      return rows[0] ? mapApparel(rows[0]) : null;
    },

    // ── S48 entities (direct-audited; the tenant's legal operating entities) ──
    async insertEntity(entityId: string, row: NewEntityRow): Promise<Entity> {
      const [r] = await db.insert(schema.entity).values({ tenantId, entityId, ...row }).returning();
      return mapEntity(r);
    },

    async getEntity(entityId: string): Promise<Entity | null> {
      const rows = await db.select().from(schema.entity).where(eq(schema.entity.entityId, entityId)).limit(1);
      return rows[0] ? mapEntity(rows[0]) : null;
    },

    async updateEntity(entityId: string, expectedVersion: number, patch: EntityPatch): Promise<Entity | null> {
      const rows = await db
        .update(schema.entity)
        .set({ ...patch, version: sql`${schema.entity.version} + 1` })
        .where(and(eq(schema.entity.entityId, entityId), eq(schema.entity.version, expectedVersion)))
        .returning();
      return rows[0] ? mapEntity(rows[0]) : null;
    },

    async deactivateEntity(entityId: string, expectedVersion: number): Promise<Entity | null> {
      const rows = await db
        .update(schema.entity)
        .set({ isActive: false, version: sql`${schema.entity.version} + 1` })
        .where(and(eq(schema.entity.entityId, entityId), eq(schema.entity.version, expectedVersion), eq(schema.entity.isActive, true)))
        .returning();
      return rows[0] ? mapEntity(rows[0]) : null;
    },

    // ── Sprint 39 missions (shell = drizzle-only; participants joined with the
    //    person's display name for the domain view) ────────────────────────────
    async insertMission(missionId: string, row: NewMissionRow): Promise<Mission> {
      const [r] = await db.insert(schema.mission).values({ tenantId, missionId, ...row }).returning();
      return mapMission(r);
    },

    async getMission(missionId: string): Promise<Mission | null> {
      const rows = await db.select().from(schema.mission).where(eq(schema.mission.missionId, missionId)).limit(1);
      return rows[0] ? mapMission(rows[0]) : null;
    },

    async updateMission(missionId: string, expectedVersion: number, patch: MissionPatch): Promise<Mission | null> {
      const rows = await db
        .update(schema.mission)
        .set({ ...patch, version: sql`${schema.mission.version} + 1` })
        .where(and(eq(schema.mission.missionId, missionId), eq(schema.mission.version, expectedVersion)))
        .returning();
      return rows[0] ? mapMission(rows[0]) : null;
    },

    async deactivateMission(missionId: string, expectedVersion: number): Promise<Mission | null> {
      const rows = await db
        .update(schema.mission)
        .set({ isActive: false, version: sql`${schema.mission.version} + 1` })
        .where(and(eq(schema.mission.missionId, missionId), eq(schema.mission.version, expectedVersion), eq(schema.mission.isActive, true)))
        .returning();
      return rows[0] ? mapMission(rows[0]) : null;
    },

    // Lock ONLY the participant row (FOR UPDATE OF mp): the person join is a
    // display read and must not serialise unrelated person writes.
    getParticipantForUpdate: (missionId, personId) => readParticipantView(missionId, personId, true),

    getParticipant: (missionId, personId) => readParticipantView(missionId, personId),

    async insertParticipant(missionId: string, personId: string, role: string): Promise<MissionParticipant> {
      // The composite FKs authoritatively require the mission and the person;
      // the UNIQUE pair constraint turns a concurrent duplicate into 23505.
      await db.insert(schema.missionParticipant).values({ tenantId, missionId, personId, role });
      const created = await readParticipantView(missionId, personId);
      if (!created) throw new Error('participant insert did not persist');
      return created;
    },

    async reactivateParticipant(missionId: string, personId: string, role: string): Promise<MissionParticipant | null> {
      const rows = await db
        .update(schema.missionParticipant)
        .set({ role, isActive: true })
        .where(
          and(
            eq(schema.missionParticipant.missionId, missionId),
            eq(schema.missionParticipant.personId, personId),
            eq(schema.missionParticipant.isActive, false),
          ),
        )
        .returning();
      return rows[0] ? readParticipantView(missionId, personId) : null;
    },

    async deactivateParticipant(missionId: string, personId: string): Promise<MissionParticipant | null> {
      const rows = await db
        .update(schema.missionParticipant)
        .set({ isActive: false })
        .where(
          and(
            eq(schema.missionParticipant.missionId, missionId),
            eq(schema.missionParticipant.personId, personId),
            eq(schema.missionParticipant.isActive, true),
          ),
        )
        .returning();
      return rows[0] ? readParticipantView(missionId, personId) : null;
    },
    // ── Sprint 41 agreements (drizzle-only; mode:'string' dates, cents int) ──
    async insertAgreement(row: NewAgreementRow): Promise<Agreement> {
      const [r] = await db.insert(schema.agreement).values({ tenantId, ...row }).returning();
      return mapAgreement(r);
    },

    async getAgreement(agreementId: string): Promise<Agreement | null> {
      const rows = await db.select().from(schema.agreement).where(eq(schema.agreement.agreementId, agreementId)).limit(1);
      return rows[0] ? mapAgreement(rows[0]) : null;
    },

    async getAgreementByCreatingApproval(approvalId: string): Promise<Agreement | null> {
      const rows = await db
        .select()
        .from(schema.agreement)
        .where(eq(schema.agreement.createdByApprovalId, approvalId))
        .limit(1);
      return rows[0] ? mapAgreement(rows[0]) : null;
    },

    async renewAgreement(agreementId: string, newEndsOn: string): Promise<Agreement | null> {
      // Statement-level guard: Active AND the new end still beats the stored
      // one (a renewal that landed in between makes this a no-op → null).
      const rows = await db
        .update(schema.agreement)
        .set({ endsOn: newEndsOn, version: sql`${schema.agreement.version} + 1` })
        .where(
          and(
            eq(schema.agreement.agreementId, agreementId),
            eq(schema.agreement.status, 'Active'),
            lt(schema.agreement.endsOn, newEndsOn),
          ),
        )
        .returning();
      return rows[0] ? mapAgreement(rows[0]) : null;
    },

    async terminateAgreement(agreementId: string): Promise<Agreement | null> {
      const rows = await db
        .update(schema.agreement)
        .set({ status: 'Terminated', version: sql`${schema.agreement.version} + 1` })
        .where(and(eq(schema.agreement.agreementId, agreementId), eq(schema.agreement.status, 'Active')))
        .returning();
      return rows[0] ? mapAgreement(rows[0]) : null;
    },

    async updateAgreement(agreementId: string, expectedVersion: number, patch: AgreementPatch): Promise<Agreement | null> {
      const rows = await db
        .update(schema.agreement)
        .set({ ...patch, version: sql`${schema.agreement.version} + 1` })
        .where(and(eq(schema.agreement.agreementId, agreementId), eq(schema.agreement.version, expectedVersion)))
        .returning();
      return rows[0] ? mapAgreement(rows[0]) : null;
    },
  } satisfies WriteTx;
}
