/**
 * agreements.test.ts — Sprint 41 C2 evidence against a REAL PostgreSQL. The
 * first domain BEYOND the CP:
 *   - governed AddAgreement (with code, value, and an addendum linked to its
 *     parent) / RenewAgreement (the write the CP never shipped) /
 *     TerminateAgreement (reason audited, terminal);
 *   - execute-time authoritative guards (a renewal that no longer extends the
 *     stored term is a truthful ExecutionFailed; the agreement-code unique
 *     index is never mistaken for idempotency);
 *   - duplicate-pending refusal per agreement (either targeted op);
 *   - the direct-audited NON-MATERIAL patch (changed-fields-only images,
 *     stale-version zero-change, self-link refusal);
 *   - the financial-omission read model (legal sees agreements WITHOUT the
 *     value FIELD; hr/visitor are denied entirely);
 *   - RLS isolation.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor, AddPersonInput, Approval } from '@c3web/domain';
import {
  submitAddAgreement,
  submitRenewAgreement,
  submitTerminateAgreement,
  updateAgreement,
  listAgreements,
  getAgreement,
  submitAddPerson,
  beginReview,
  approveApproval,
  executeApproval,
  type ExecuteResult,
} from '@c3web/application';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { createPersistence, type PersistenceHandle } from '../src/index';

let db: TestDatabase;
let p: PersistenceHandle;

const actor = (tenantId: string, email: string, role: string): Actor =>
  ({ userId: '00000000-0000-0000-0000-0000000000ff', identity: email, displayName: email, role: role as Actor['role'], tenantId });

let alphaId: string;
let bravoId: string;
let alphaOwner: Actor;
let alphaOps: Actor;
let alphaLegal: Actor;
let alphaFinance: Actor;
let alphaHr: Actor;
let alphaVisitor: Actor;
let bravoOwner: Actor;

async function addPerson(fullName: string): Promise<string> {
  const a = await submitAddPerson(p, alphaOps, { input: { fullName } as AddPersonInput });
  const res = await governedExecute(a);
  return res.person!.personId;
}

/** owner (≠ requester) walks the approval to execution. */
async function governedExecute(a: Approval): Promise<ExecuteResult> {
  const inReview = await beginReview(p, alphaOwner, a.approvalId, a.version);
  const approved = await approveApproval(p, alphaOwner, inReview.approvalId, inReview.version);
  return executeApproval(p, alphaOwner, approved.approvalId, approved.version);
}

async function addAgreement(personId: string, extras: Record<string, unknown> = {}): Promise<ExecuteResult> {
  const a = await submitAddAgreement(p, alphaOps, {
    input: { personId, agreementType: 'Player Contract', startsOn: '2026-08-01', endsOn: '2027-07-31', ...extras } as Parameters<typeof submitAddAgreement>[2]['input'],
  });
  return governedExecute(a);
}

beforeAll(async () => {
  db = await startTestDatabase();
  p = createPersistence({ appConnectionString: db.appUrl });
}, 180_000);

afterAll(async () => {
  await p?.close();
  await db?.stop();
});

beforeEach(async () => {
  await db.truncateAll();
  const alpha = await db.seedTenant({
    slug: 'alpha',
    users: [
      { key: 'owner', email: 'owner@a.com', displayName: 'Owner A', role: 'owner' },
      { key: 'ops', email: 'ops@a.com', displayName: 'Ops A', role: 'operations' },
      { key: 'legal', email: 'legal@a.com', displayName: 'Legal A', role: 'legal' },
      { key: 'finance', email: 'finance@a.com', displayName: 'Finance A', role: 'finance' },
      { key: 'hr', email: 'hr@a.com', displayName: 'HR A', role: 'hr' },
      { key: 'visitor', email: 'visitor@a.com', displayName: 'Visitor A', role: 'visitor' },
    ],
  });
  const bravo = await db.seedTenant({
    slug: 'bravo',
    users: [{ key: 'owner', email: 'owner@b.com', displayName: 'Owner B', role: 'owner' }],
  });
  alphaId = alpha.tenantId;
  bravoId = bravo.tenantId;
  alphaOwner = actor(alphaId, 'owner@a.com', 'owner');
  alphaOps = actor(alphaId, 'ops@a.com', 'operations');
  alphaLegal = actor(alphaId, 'legal@a.com', 'legal');
  alphaFinance = actor(alphaId, 'finance@a.com', 'finance');
  alphaHr = actor(alphaId, 'hr@a.com', 'hr');
  alphaVisitor = actor(alphaId, 'visitor@a.com', 'visitor');
  bravoOwner = actor(bravoId, 'owner@b.com', 'owner');
});

describe('governed AddAgreement (with code, value, and addendum linkage)', () => {
  it('full chain: contract with code + value, then an NDA addendum LINKED to it', async () => {
    const personId = await addPerson('Star Player');
    const res = await addAgreement(personId, { agreementCode: 'GKE-PL-2026-001', valueUsdCents: 25_000_000 });
    expect(res.agreement).toMatchObject({
      agreementId: 'AGR-0001',
      agreementCode: 'GKE-PL-2026-001',
      valueUsdCents: 25_000_000,
      status: 'Active',
      startsOn: '2026-08-01',
      endsOn: '2027-07-31',
      version: 0,
    });

    const nda = await addAgreement(personId, { agreementType: 'NDA Addendum', linkedAgreementId: 'AGR-0001' });
    expect(nda.agreement).toMatchObject({ agreementId: 'AGR-0002', linkedAgreementId: 'AGR-0001', valueUsdCents: null });

    const audit = await p.reads.forActor(alphaOwner).listAuditEventsForEntity('Agreement', 'AGR-0001');
    expect(audit.map((e) => e.action)).toEqual(['AgreementCreated']);
  });

  it('submit refusals: unknown person, unknown parent link, taken agreement code', async () => {
    const personId = await addPerson('Only Person');
    await addAgreement(personId, { agreementCode: 'CODE-1' });

    await expect(
      submitAddAgreement(p, alphaOps, { input: { personId: 'PER-9999', agreementType: 'NDA', startsOn: '2026-08-01', endsOn: '2027-07-31' } }),
    ).rejects.toThrow(/Person not found/i);
    await expect(
      submitAddAgreement(p, alphaOps, { input: { personId, agreementType: 'Addendum', linkedAgreementId: 'AGR-9999', startsOn: '2026-08-01', endsOn: '2027-07-31' } }),
    ).rejects.toThrow(/Linked agreement not found/i);
    await expect(
      submitAddAgreement(p, alphaOps, { input: { personId, agreementType: 'NDA', agreementCode: 'CODE-1', startsOn: '2026-08-01', endsOn: '2027-07-31' } }),
    ).rejects.toThrow(/already in use/i);
  });

  it('the code-unique index at execute is a truthful ExecutionFailed, never idempotency', async () => {
    const personId = await addPerson('Code Clash');
    await addAgreement(personId, { agreementCode: 'CLASH' });

    // Craft the race the submit guard cannot see: an Approved AddAgreement
    // whose code was taken between submit and execution.
    const crafted = await p.writes.transaction(alphaOps, async (tx) => {
      const seq = await tx.allocateSequence('approval');
      return tx.insertApproval({
        approvalId: `APR-${String(seq).padStart(4, '0')}`,
        operationType: 'AddAgreement',
        targetPersonId: personId,
        targetId: null,
        reason: null,
        payload: {
          operationType: 'AddAgreement',
          input: { personId, agreementCode: 'CLASH', agreementType: 'NDA', linkedAgreementId: null, startsOn: '2026-08-01', endsOn: '2027-07-31', valueUsdCents: null, notes: null },
        },
        submittedBy: alphaOps.identity,
      });
    });
    const inReview = await beginReview(p, alphaOwner, crafted.approvalId, crafted.version);
    const approved = await approveApproval(p, alphaOwner, inReview.approvalId, inReview.version);
    await expect(executeApproval(p, alphaOwner, approved.approvalId, approved.version)).rejects.toThrow();

    const failed = await p.reads.forActor(alphaOwner).getApprovalById(crafted.approvalId);
    expect(failed?.status).toBe('ExecutionFailed');
    expect(await p.reads.forActor(alphaOwner).listAgreements()).toHaveLength(1); // no second row
  });
});

describe('governed RenewAgreement (the write the CP never shipped)', () => {
  it('extends the term with an endsOn-only audit image; version moves', async () => {
    const personId = await addPerson('Renewed Player');
    await addAgreement(personId);
    const res = await governedExecute(
      await submitRenewAgreement(p, alphaOps, { input: { agreementId: 'AGR-0001', newEndsOn: '2028-07-31' } }),
    );
    expect(res.agreement).toMatchObject({ endsOn: '2028-07-31', version: 1, status: 'Active' });

    const audit = await p.reads.forActor(alphaOwner).listAuditEventsForEntity('Agreement', 'AGR-0001');
    const renewed = audit.find((e) => e.action === 'AgreementRenewed')!;
    expect(renewed.before).toEqual({ endsOn: '2027-07-31' });
    expect(renewed.after).toEqual({ endsOn: '2028-07-31' });
  });

  it('refuses at submit when the new end does not extend; authoritatively at execute after a race', async () => {
    const personId = await addPerson('Race Renewal');
    await addAgreement(personId);

    await expect(
      submitRenewAgreement(p, alphaOps, { input: { agreementId: 'AGR-0001', newEndsOn: '2027-07-31' } }),
    ).rejects.toThrow(/does not extend/i);

    // Craft: an Approved renewal to 2027-12-31, but the term already moved to
    // 2028-07-31 in between — execute must refuse truthfully.
    await governedExecute(await submitRenewAgreement(p, alphaOps, { input: { agreementId: 'AGR-0001', newEndsOn: '2028-07-31' } }));
    const crafted = await p.writes.transaction(alphaOps, async (tx) => {
      const seq = await tx.allocateSequence('approval');
      return tx.insertApproval({
        approvalId: `APR-${String(seq).padStart(4, '0')}`,
        operationType: 'RenewAgreement',
        targetPersonId: personId,
        targetId: 'AGR-0001',
        reason: null,
        payload: { operationType: 'RenewAgreement', input: { agreementId: 'AGR-0001', newEndsOn: '2027-12-31' } },
        submittedBy: alphaOps.identity,
      });
    });
    const inReview = await beginReview(p, alphaOwner, crafted.approvalId, crafted.version);
    const approved = await approveApproval(p, alphaOwner, inReview.approvalId, inReview.version);
    await expect(executeApproval(p, alphaOwner, approved.approvalId, approved.version)).rejects.toThrow(/no longer extends/i);

    expect((await p.reads.forActor(alphaOwner).getApprovalById(crafted.approvalId))?.status).toBe('ExecutionFailed');
    expect((await getAgreement(p, alphaOwner, 'AGR-0001')).endsOn).toBe('2028-07-31'); // untouched
  });
});

describe('governed TerminateAgreement + the per-agreement pending guard', () => {
  it('terminates with the reason audited; terminal absorbs further material ops at submit', async () => {
    const personId = await addPerson('Terminated Player');
    await addAgreement(personId);
    const res = await governedExecute(
      await submitTerminateAgreement(p, alphaOps, { input: { agreementId: 'AGR-0001', reason: 'Mutual exit' } }),
    );
    expect(res.agreement).toMatchObject({ status: 'Terminated' });

    const audit = await p.reads.forActor(alphaOwner).listAuditEventsForEntity('Agreement', 'AGR-0001');
    const term = audit.find((e) => e.action === 'AgreementTerminated')!;
    expect(term.after).toEqual({ status: 'Terminated', reason: 'Mutual exit' });

    await expect(
      submitRenewAgreement(p, alphaOps, { input: { agreementId: 'AGR-0001', newEndsOn: '2030-01-01' } }),
    ).rejects.toThrow(/not active/i);
  });

  it('an open renewal blocks BOTH a second renewal and a termination (zero new approvals)', async () => {
    const personId = await addPerson('Pending Guard');
    await addAgreement(personId);
    await submitRenewAgreement(p, alphaOps, { input: { agreementId: 'AGR-0001', newEndsOn: '2028-07-31' } });

    const before = (await p.reads.forActor(alphaOwner).listApprovals()).length;
    await expect(
      submitRenewAgreement(p, alphaOps, { input: { agreementId: 'AGR-0001', newEndsOn: '2029-07-31' } }),
    ).rejects.toThrow(/open approval already exists/i);
    await expect(
      submitTerminateAgreement(p, alphaOps, { input: { agreementId: 'AGR-0001', reason: 'Nope' } }),
    ).rejects.toThrow(/open approval already exists/i);
    expect((await p.reads.forActor(alphaOwner).listApprovals()).length).toBe(before);
  });
});

describe('direct-audited NON-MATERIAL patch', () => {
  it('changed-fields-only images; no-op returns current; stale version zero-change; self-link refused', async () => {
    const personId = await addPerson('Edited Agreement');
    await addAgreement(personId);
    const updated = await updateAgreement(p, alphaOps, 'AGR-0001', { expectedVersion: 0, agreementCode: 'GKE-PL-2026-002', notes: 'Countersigned' });
    expect(updated).toMatchObject({ agreementCode: 'GKE-PL-2026-002', notes: 'Countersigned', version: 1 });

    const audit = await p.reads.forActor(alphaOwner).listAuditEventsForEntity('Agreement', 'AGR-0001');
    const upd = audit.find((e) => e.action === 'AgreementUpdated')!;
    expect(upd.before).toEqual({ agreementCode: null, notes: null });
    expect(upd.after).toEqual({ agreementCode: 'GKE-PL-2026-002', notes: 'Countersigned' });
    expect('agreementType' in (upd.after ?? {})).toBe(false); // unchanged fields stay out

    const noop = await updateAgreement(p, alphaOps, 'AGR-0001', { expectedVersion: 1, notes: 'Countersigned' });
    expect(noop.version).toBe(1); // nothing changed, no bump, no audit row
    expect((await p.reads.forActor(alphaOwner).listAuditEventsForEntity('Agreement', 'AGR-0001')).filter((e) => e.action === 'AgreementUpdated')).toHaveLength(1);

    await expect(updateAgreement(p, alphaOps, 'AGR-0001', { expectedVersion: 0, notes: 'Stale' })).rejects.toThrow(/modified concurrently/i);
    await expect(updateAgreement(p, alphaOps, 'AGR-0001', { expectedVersion: 1, linkedAgreementId: 'AGR-0001' })).rejects.toThrow(/linked to itself/i);
  });
});

describe('the financial-omission read model (CP Set-E boundary)', () => {
  it('finance sees the value FIELD; legal does not have the field AT ALL; hr/visitor are denied', async () => {
    const personId = await addPerson('Money Player');
    await addAgreement(personId, { valueUsdCents: 9_999_00 });

    const finance = await listAgreements(p, alphaFinance);
    expect(finance[0]!.valueUsdCents).toBe(999_900);
    expect('valueUsdCents' in finance[0]!).toBe(true);

    const legal = await listAgreements(p, alphaLegal);
    expect('valueUsdCents' in legal[0]!).toBe(false); // structural omission, not null

    await expect(listAgreements(p, alphaHr)).rejects.toThrow(/unavailable for your role/i);
    await expect(listAgreements(p, alphaVisitor)).rejects.toThrow(/unavailable for your role/i);
  });
});

describe('isolation', () => {
  it('agreements are tenant-isolated (RLS): bravo sees nothing of alpha', async () => {
    const personId = await addPerson('Isolated Player');
    await addAgreement(personId);
    expect(await listAgreements(p, bravoOwner)).toHaveLength(0);
    await expect(getAgreement(p, bravoOwner, 'AGR-0001')).rejects.toThrow(/not found/i);
    expect(await listAgreements(p, alphaOwner)).toHaveLength(1);
  });
});
