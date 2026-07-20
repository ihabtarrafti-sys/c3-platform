/**
 * agreementTerms.test.ts — Finance Sprint 3 (read) + 3.5 (GOVERNED writes)
 * evidence against a REAL PostgreSQL. Term money is material, so add / edit /
 * remove ride the approval pipeline (ops submits, owner executes). Covers the
 * governed round-trips + same-tx audit, the per-kind shape rule (submit-time +
 * execute-time assertTermShape), the owner/operations SUBMIT gate, the
 * canViewFinancials READ gate (legal reads agreements WITHOUT terms), the
 * active-agreement-only rule, the duplicate-pending-per-term guard, and RLS.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor, AddPersonInput } from '@c3web/domain';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@c3web/domain';
import {
  listAgreementTerms,
  submitAddAgreementTerm,
  submitUpdateAgreementTerm,
  submitRemoveAgreementTerm,
  submitAddPerson,
  submitAddAgreement,
  submitTerminateAgreement,
  beginReview,
  approveApproval,
  executeApproval,
} from '@c3web/application';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { createPersistence, type PersistenceHandle } from '../src/index';

let db: TestDatabase;
let p: PersistenceHandle;

const actor = (tenantId: string, email: string, role: string): Actor =>
  ({ userId: '00000000-0000-0000-0000-0000000000ff', identity: email, displayName: email, role: role as Actor['role'], tenantId });

let alphaId: string;
let alphaOwner: Actor;
let alphaOps: Actor;
let alphaFinance: Actor;
let alphaLegal: Actor;
let alphaVisitor: Actor;
let bravoOwner: Actor;

/** ops submits, owner executes (requester ≠ approver). Returns the executed result. */
async function execAsOwner(approvalId: string, version: number) {
  const inReview = await beginReview(p, alphaOwner, approvalId, version);
  const approved = await approveApproval(p, alphaOwner, inReview.approvalId, inReview.version);
  return executeApproval(p, alphaOwner, approved.approvalId, approved.version);
}

async function addPerson(fullName: string): Promise<string> {
  const a = await submitAddPerson(p, alphaOps, { input: { fullName } as AddPersonInput });
  const res = await execAsOwner(a.approvalId, a.version);
  return res.person!.personId;
}

async function addAgreement(personId: string): Promise<string> {
  const sub = await submitAddAgreement(p, alphaOps, {
    input: { personId, agreementType: 'Player Contract', startsOn: '2026-01-01', endsOn: '2027-01-01' } as never,
  });
  const res = await execAsOwner(sub.approvalId, sub.version);
  return res.agreement!.agreementId;
}

async function terminate(agreementId: string): Promise<void> {
  const sub = await submitTerminateAgreement(p, alphaOps, { input: { agreementId, reason: 'end of season' } });
  await execAsOwner(sub.approvalId, sub.version);
}

/** Governed term add: ops submits, owner executes. */
async function governedAddTerm(agreementId: string, input: Record<string, unknown>): Promise<void> {
  const sub = await submitAddAgreementTerm(p, alphaOps, { input: { agreementId, ...input } as never });
  await execAsOwner(sub.approvalId, sub.version);
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
      { key: 'finance', email: 'finance@a.com', displayName: 'Finance A', role: 'finance' },
      { key: 'legal', email: 'legal@a.com', displayName: 'Legal A', role: 'legal' },
      { key: 'visitor', email: 'visitor@a.com', displayName: 'Visitor A', role: 'visitor' },
    ],
  });
  const bravo = await db.seedTenant({ slug: 'bravo', users: [{ key: 'owner', email: 'owner@b.com', displayName: 'Owner B', role: 'owner' }] });
  alphaId = alpha.tenantId;
  alphaOwner = actor(alphaId, 'owner@a.com', 'owner');
  alphaOps = actor(alphaId, 'ops@a.com', 'operations');
  alphaFinance = actor(alphaId, 'finance@a.com', 'finance');
  alphaLegal = actor(alphaId, 'legal@a.com', 'legal');
  alphaVisitor = actor(alphaId, 'visitor@a.com', 'visitor');
  bravoOwner = actor(bravo.tenantId, 'owner@b.com', 'owner');
});

describe('agreement terms — governed money changes (Sprint 3.5)', () => {
  it('governed add → list; governed update; governed remove; each executed & audited', async () => {
    const agr = await addAgreement(await addPerson('Kairo Mendes'));

    await governedAddTerm(agr, { kind: 'Salary', amountMinor: 500_000, currency: 'AED', label: 'Base monthly' });
    await governedAddTerm(agr, { kind: 'PrizeSharePersonal', percentBps: 750 });

    let terms = await listAgreementTerms(p, alphaOwner, agr);
    expect(terms.map((t) => ({ id: t.termId, kind: t.kind }))).toEqual([
      { id: 'TRM-0001', kind: 'Salary' },
      { id: 'TRM-0002', kind: 'PrizeSharePersonal' },
    ]);
    expect(terms[0]).toMatchObject({ amountMinor: 500_000, currency: 'AED', percentBps: null });
    expect(terms[1]).toMatchObject({ percentBps: 750, amountMinor: null, currency: null });

    // governed update of the salary
    const updSub = await submitUpdateAgreementTerm(p, alphaOps, {
      input: { agreementId: agr, termId: 'TRM-0001', amountMinor: 600_000, currency: 'AED', label: 'Base monthly' },
    });
    await execAsOwner(updSub.approvalId, updSub.version);
    terms = await listAgreementTerms(p, alphaOwner, agr);
    expect(terms.find((t) => t.termId === 'TRM-0001')).toMatchObject({ amountMinor: 600_000, version: 1 });

    // governed remove of the share
    const rmSub = await submitRemoveAgreementTerm(p, alphaOps, { input: { agreementId: agr, termId: 'TRM-0002' } });
    await execAsOwner(rmSub.approvalId, rmSub.version);
    terms = await listAgreementTerms(p, alphaOwner, agr);
    expect(terms.map((t) => t.termId)).toEqual(['TRM-0001']); // removed row hidden

    const audit = await p.reads.forActor(alphaOwner).listAuditEventsForEntity('Agreement', agr);
    expect(audit.map((a) => a.action)).toEqual([
      'AgreementCreated',
      'AgreementTermAdded',
      'AgreementTermAdded',
      'AgreementTermUpdated',
      'AgreementTermRemoved',
    ]);
    const upd = audit.find((a) => a.action === 'AgreementTermUpdated')!;
    expect(upd.before).toMatchObject({ amountMinor: 500_000 });
    expect(upd.after).toMatchObject({ amountMinor: 600_000 });
  });

  it('the shape rule is enforced at SUBMIT (assertTermShape): monetary needs currency; share needs %; milestone needs a trigger', async () => {
    const agr = await addAgreement(await addPerson('Shape Tester'));
    await expect(submitAddAgreementTerm(p, alphaOps, { input: { agreementId: agr, kind: 'Salary', amountMinor: 1000 } as never })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      submitAddAgreementTerm(p, alphaOps, { input: { agreementId: agr, kind: 'PrizeShareTeam', percentBps: 500, amountMinor: 100, currency: 'USD' } as never }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      submitAddAgreementTerm(p, alphaOps, { input: { agreementId: agr, kind: 'Milestone', amountMinor: 100_000, currency: 'USD' } as never }),
    ).rejects.toBeInstanceOf(ValidationError);
    // a valid milestone WITH a trigger submits fine
    await expect(
      submitAddAgreementTerm(p, alphaOps, { input: { agreementId: agr, kind: 'Milestone', amountMinor: 100_000, currency: 'USD', label: 'Reach playoffs' } as never }),
    ).resolves.toBeTruthy();
  });

  it('SUBMIT gate: only owner/operations may request a change (finance can VIEW but not submit)', async () => {
    const agr = await addAgreement(await addPerson('Gate Tester'));
    await governedAddTerm(agr, { kind: 'Salary', amountMinor: 100_000, currency: 'SAR' });

    await expect(submitAddAgreementTerm(p, alphaFinance, { input: { agreementId: agr, kind: 'Salary', amountMinor: 1, currency: 'SAR' } as never })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(submitAddAgreementTerm(p, alphaVisitor, { input: { agreementId: agr, kind: 'Salary', amountMinor: 1, currency: 'SAR' } as never })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await listAgreementTerms(p, alphaFinance, agr)).toHaveLength(1); // finance CAN read
  });

  it('READ gate: legal reads the agreement WITHOUT terms (canViewFinancials denied); visitor denied entirely', async () => {
    const agr = await addAgreement(await addPerson('Read Tester'));
    await governedAddTerm(agr, { kind: 'Salary', amountMinor: 100_000, currency: 'USD' });

    expect(await p.reads.forActor(alphaLegal).getAgreementById(agr)).toBeTruthy();
    await expect(listAgreementTerms(p, alphaLegal, agr)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listAgreementTerms(p, alphaVisitor, agr)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await listAgreementTerms(p, alphaOwner, agr)).toHaveLength(1);
  });

  it('terms may only be changed on an ACTIVE agreement (terminated = frozen record)', async () => {
    const agr = await addAgreement(await addPerson('Freeze Tester'));
    await governedAddTerm(agr, { kind: 'Salary', amountMinor: 100_000, currency: 'USD' });
    await terminate(agr);

    await expect(submitAddAgreementTerm(p, alphaOps, { input: { agreementId: agr, kind: 'PerformanceBonus', amountMinor: 5000, currency: 'USD' } as never })).rejects.toBeInstanceOf(ConflictError);
    await expect(submitUpdateAgreementTerm(p, alphaOps, { input: { agreementId: agr, termId: 'TRM-0001', amountMinor: 1, currency: 'USD' } })).rejects.toBeInstanceOf(ConflictError);
    await expect(submitRemoveAgreementTerm(p, alphaOps, { input: { agreementId: agr, termId: 'TRM-0001' } })).rejects.toBeInstanceOf(ConflictError);
    expect(await listAgreementTerms(p, alphaOwner, agr)).toHaveLength(1); // still readable
  });

  it('duplicate-pending per term: a second open change to the same term is refused at submit', async () => {
    const agr = await addAgreement(await addPerson('Dup Tester'));
    await governedAddTerm(agr, { kind: 'Salary', amountMinor: 100_000, currency: 'USD' });

    await submitUpdateAgreementTerm(p, alphaOps, { input: { agreementId: agr, termId: 'TRM-0001', amountMinor: 200_000, currency: 'USD' } });
    // an open update on TRM-0001 blocks a second change (update or remove) to it
    await expect(submitUpdateAgreementTerm(p, alphaOps, { input: { agreementId: agr, termId: 'TRM-0001', amountMinor: 300_000, currency: 'USD' } })).rejects.toBeInstanceOf(ConflictError);
    await expect(submitRemoveAgreementTerm(p, alphaOps, { input: { agreementId: agr, termId: 'TRM-0001' } })).rejects.toBeInstanceOf(ConflictError);
  });

  it('is tenant-isolated (RLS): another tenant cannot reach the agreement/terms', async () => {
    const agr = await addAgreement(await addPerson('Iso Tester'));
    await governedAddTerm(agr, { kind: 'Salary', amountMinor: 100_000, currency: 'USD' });
    await expect(listAgreementTerms(p, bravoOwner, agr)).rejects.toBeInstanceOf(NotFoundError);
  });
});
