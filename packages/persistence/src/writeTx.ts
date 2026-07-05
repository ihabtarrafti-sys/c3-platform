/**
 * writeTx.ts — WriteTx implementation bound to a single tenant transaction.
 * All statements run under the transaction's `app.tenant_id` (RLS enforced).
 */
import { sql } from 'drizzle-orm';
import type { Actor, Approval, Person } from '@c3web/domain';
import type { NewApprovalRow, NewPersonRow, WriteTx } from '@c3web/application';
import type { Db } from './tenantContext';
import * as schema from './schema';
import { mapApproval, mapPerson } from './mappers';

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
  } satisfies WriteTx;
}
