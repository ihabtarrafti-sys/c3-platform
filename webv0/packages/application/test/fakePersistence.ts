/**
 * A single-process in-memory Persistence for fast use-case unit tests. It
 * mirrors the invariants the real DB enforces (per-tenant counters, unique
 * person business id + unique created_by_approval_id, version-guarded updates)
 * and supports fault injection to exercise the ExecutionFailed path.
 */
import type {
  Actor,
  Approval,
  ApprovalEvent,
  ApprovalStatus,
  AuditEvent,
  Person,
} from '@c3web/domain';
import type { NewApprovalRow, NewPersonRow, Persistence, ReadStore, WriteTx } from '../src/ports';

interface Store {
  approvals: Approval[];
  people: Person[];
  approvalEvents: ApprovalEvent[];
  auditEvents: AuditEvent[];
  counters: Map<string, number>;
}

class UniqueViolation extends Error {
  code = '23505';
}

export class FakePersistence implements Persistence {
  private stores = new Map<string, Store>();
  failNextPersonInsert = false;

  private store(tenantId: string): Store {
    let s = this.stores.get(tenantId);
    if (!s) {
      s = { approvals: [], people: [], approvalEvents: [], auditEvents: [], counters: new Map() };
      this.stores.set(tenantId, s);
    }
    return s;
  }

  reads = {
    forActor: (actor: Actor): ReadStore => {
      const s = this.store(actor.tenantId);
      return {
        listPeople: async () => [...s.people].sort((a, b) => a.personId.localeCompare(b.personId)),
        getPersonById: async (personId) => s.people.find((p) => p.personId === personId) ?? null,
        listApprovals: async (filter) =>
          s.approvals
            .filter((a) => !filter?.statuses || filter.statuses.includes(a.status))
            .sort((a, b) => b.approvalId.localeCompare(a.approvalId)),
        getApprovalById: async (approvalId) => s.approvals.find((a) => a.approvalId === approvalId) ?? null,
        listApprovalEvents: async (approvalId) =>
          s.approvalEvents.filter((e) => e.approvalId === approvalId),
        listAuditEventsForEntity: async (entityType, entityId) =>
          s.auditEvents.filter((e) => e.entityType === entityType && e.entityId === entityId),
        // Tier 0.5: the fake tenant has no delegations — role gates decide alone.
        listDelegations: async () => [],
        hasActiveDelegation: async () => false,
        findUnrevokedDelegationId: async () => null,
        // S12: the fake tenant has no beneficiaries.
        listBeneficiaries: async () => [],
        listBeneficiariesForPerson: async () => [],
        getBeneficiaryById: async () => null,
      };
    },
  };

  writes = {
    transaction: <T>(actor: Actor, fn: (tx: WriteTx) => Promise<T>): Promise<T> => fn(this.makeTx(actor)),
  };

  private makeTx(actor: Actor): WriteTx {
    const s = this.store(actor.tenantId);
    const nowIso = () => new Date().toISOString();
    return {
      allocateSequence: async (kind) => {
        const next = (s.counters.get(kind) ?? 0) + 1;
        s.counters.set(kind, next);
        return next;
      },
      insertApproval: async (row: NewApprovalRow): Promise<Approval> => {
        if (s.approvals.some((a) => a.approvalId === row.approvalId)) throw new UniqueViolation('dup approval');
        const approval: Approval = {
          approvalId: row.approvalId,
          tenantId: actor.tenantId,
          operationType: row.operationType,
          targetPersonId: row.targetPersonId,
          targetId: row.targetId,
          reason: row.reason,
          status: 'Submitted',
          payload: row.payload as Approval['payload'],
          submittedBy: row.submittedBy,
          submittedAt: nowIso(),
          reviewedBy: null,
          reviewedAt: null,
          rejectionReason: null,
          executedAt: null,
          executionError: null,
          version: 0,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        s.approvals.push(approval);
        return approval;
      },
      lockApproval: async (approvalId) => s.approvals.find((a) => a.approvalId === approvalId) ?? null,
      // Tier 0.5: no delegations in the fake — the role half of the gate decides.
      hasActiveDelegation: async () => false,
      updateApprovalStatus: async (approvalId, expectedVersion, patch): Promise<Approval | null> => {
        const idx = s.approvals.findIndex((a) => a.approvalId === approvalId);
        if (idx < 0) return null;
        const cur = s.approvals[idx]!;
        if (cur.version !== expectedVersion) return null;
        const next: Approval = {
          ...cur,
          status: patch.status as ApprovalStatus,
          version: cur.version + 1,
          updatedAt: nowIso(),
          ...('reviewedBy' in patch ? { reviewedBy: patch.reviewedBy ?? null } : {}),
          ...('reviewedAt' in patch ? { reviewedAt: patch.reviewedAt ?? null } : {}),
          ...('rejectionReason' in patch ? { rejectionReason: patch.rejectionReason ?? null } : {}),
          ...('executedAt' in patch ? { executedAt: patch.executedAt ?? null } : {}),
          ...('executionError' in patch ? { executionError: patch.executionError ?? null } : {}),
          ...(patch.targetPersonId !== undefined ? { targetPersonId: patch.targetPersonId } : {}),
        };
        s.approvals[idx] = next;
        return next;
      },
      insertPerson: async (row: NewPersonRow): Promise<Person> => {
        if (this.failNextPersonInsert) {
          this.failNextPersonInsert = false;
          throw new Error('simulated execution fault');
        }
        if (s.people.some((p) => p.personId === row.personId)) throw new UniqueViolation('dup person id');
        if (row.createdByApprovalId && s.people.some((p) => p['createdByApprovalId' as keyof Person] === row.createdByApprovalId)) {
          throw new UniqueViolation('dup created_by_approval_id');
        }
        const person: Person & { createdByApprovalId?: string } = {
          personId: row.personId,
          tenantId: actor.tenantId,
          fullName: row.fullName,
          ign: row.ign,
          nationality: row.nationality,
          primaryRole: row.primaryRole,
          personnelCode: row.personnelCode,
          currentTeam: row.currentTeam,
          currentGameTitle: row.currentGameTitle,
          primaryDepartment: row.primaryDepartment,
          notes: row.notes,
          isActive: true,
          version: 0,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          createdByApprovalId: row.createdByApprovalId,
        };
        s.people.push(person);
        return person;
      },
      getPersonByCreatingApproval: async (approvalId) =>
        s.people.find((p) => (p as Person & { createdByApprovalId?: string }).createdByApprovalId === approvalId) ?? null,
      appendApprovalEvent: async (evt) => {
        s.approvalEvents.push({
          approvalId: evt.approvalId,
          tenantId: actor.tenantId,
          fromStatus: evt.fromStatus,
          toStatus: evt.toStatus,
          actor: evt.actor,
          at: nowIso(),
          note: evt.note ?? null,
        });
      },
      appendAuditEvent: async (evt) => {
        s.auditEvents.push({
          tenantId: actor.tenantId,
          entityType: evt.entityType,
          entityId: evt.entityId,
          action: evt.action,
          actor: evt.actor,
          at: nowIso(),
          before: evt.before ?? null,
          after: evt.after ?? null,
        } as AuditEvent);
      },
    };
  }
}
