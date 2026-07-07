/**
 * writeTx.ts — WriteTx implementation bound to a single tenant transaction.
 * All statements run under the transaction's `app.tenant_id` (RLS enforced).
 */
import { and, eq, sql } from 'drizzle-orm';
import {
  ConflictError,
  IdentityAlreadyBoundError,
  LastOwnerProtectionError,
  NotFoundError,
  SelfAdministrationError,
  TenantContextMissingError,
  type Actor,
  type Approval,
  type C3Role,
  type Credential,
  type Member,
  type Person,
} from '@c3web/domain';
import type { NewApprovalRow, NewCredentialRow, NewPersonRow, WriteTx } from '@c3web/application';
import type { Db } from './tenantContext';
import * as schema from './schema';
import { mapApproval, mapCredential, mapPerson } from './mappers';

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
  } satisfies WriteTx;
}
