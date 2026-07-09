/**
 * agreementTerms.test.ts — Finance Sprint 3 evidence against a REAL PostgreSQL.
 * Covers the direct-audited agreement financial terms: monetary + percent
 * shapes, the per-kind shape rule (assertTermShape + DB CHECK backstop), the
 * version-guarded update/remove, same-transaction audit, the owner/operations
 * write gate, the canViewFinancials READ gate (legal reads agreements WITHOUT
 * terms), the active-agreement-only write rule, and RLS isolation.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor, AddPersonInput } from '@c3web/domain';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@c3web/domain';
import {
  addAgreementTerm,
  updateAgreementTerm,
  removeAgreementTerm,
  listAgreementTerms,
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
  ({ identity: email, displayName: email, role: role as Actor['role'], tenantId });

let alphaId: string;
let alphaOwner: Actor;
let alphaOps: Actor;
let alphaFinance: Actor;
let alphaLegal: Actor;
let alphaVisitor: Actor;
let bravoOwner: Actor;

async function addPerson(fullName: string): Promise<string> {
  const a = await submitAddPerson(p, alphaOps, { input: { fullName } as AddPersonInput });
  const inReview = await beginReview(p, alphaOwner, a.approvalId, a.version);
  const approved = await approveApproval(p, alphaOwner, inReview.approvalId, inReview.version);
  const res = await executeApproval(p, alphaOwner, approved.approvalId, approved.version);
  return res.person!.personId;
}

async function addAgreement(personId: string): Promise<string> {
  const sub = await submitAddAgreement(p, alphaOps, {
    input: { personId, agreementType: 'Player Contract', startsOn: '2026-01-01', endsOn: '2027-01-01' } as never,
  });
  const inReview = await beginReview(p, alphaOwner, sub.approvalId, sub.version);
  const approved = await approveApproval(p, alphaOwner, inReview.approvalId, inReview.version);
  const res = await executeApproval(p, alphaOwner, approved.approvalId, approved.version);
  return res.agreement!.agreementId;
}

async function terminate(agreementId: string): Promise<void> {
  const sub = await submitTerminateAgreement(p, alphaOps, { input: { agreementId, reason: 'end of season' } });
  const inReview = await beginReview(p, alphaOwner, sub.approvalId, sub.version);
  const approved = await approveApproval(p, alphaOwner, inReview.approvalId, inReview.version);
  await executeApproval(p, alphaOwner, approved.approvalId, approved.version);
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

describe('agreement terms (direct-audited money detail)', () => {
  it('add a monetary + a percent term → list; update; remove; all audited same-tx', async () => {
    const personId = await addPerson('Kairo Mendes');
    const agr = await addAgreement(personId);

    const salary = await addAgreementTerm(p, alphaOps, agr, { kind: 'Salary', amountMinor: 500_000, currency: 'AED', label: 'Base monthly' } as never);
    expect(salary).toMatchObject({ termId: 'TRM-0001', kind: 'Salary', amountMinor: 500_000, currency: 'AED', percentBps: null, version: 0 });

    const share = await addAgreementTerm(p, alphaOps, agr, { kind: 'PrizeSharePersonal', percentBps: 750 } as never);
    expect(share).toMatchObject({ termId: 'TRM-0002', kind: 'PrizeSharePersonal', percentBps: 750, amountMinor: null, currency: null });

    let terms = await listAgreementTerms(p, alphaOwner, agr);
    expect(terms.map((t) => t.termId)).toEqual(['TRM-0001', 'TRM-0002']);

    // update the salary (version-guarded, whole-value replacement)
    const bumped = await updateAgreementTerm(p, alphaOps, agr, salary.termId, {
      expectedVersion: salary.version,
      amountMinor: 600_000,
      currency: 'AED',
      label: 'Base monthly',
    } as never);
    expect(bumped).toMatchObject({ amountMinor: 600_000, version: 1 });
    // a stale version is refused
    await expect(
      updateAgreementTerm(p, alphaOps, agr, salary.termId, { expectedVersion: 0, amountMinor: 1, currency: 'AED' } as never),
    ).rejects.toThrow();

    // soft-remove the share
    const removed = await removeAgreementTerm(p, alphaOps, agr, share.termId, share.version);
    expect(removed.termId).toBe('TRM-0002');
    terms = await listAgreementTerms(p, alphaOwner, agr);
    expect(terms.map((t) => t.termId)).toEqual(['TRM-0001']); // removed row is hidden

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

  it('enforces the per-kind shape (assertTermShape): monetary needs currency, share needs %, milestone needs a trigger', async () => {
    const agr = await addAgreement(await addPerson('Shape Tester'));
    // Salary without a currency
    await expect(addAgreementTerm(p, alphaOps, agr, { kind: 'Salary', amountMinor: 1000 } as never)).rejects.toBeInstanceOf(ValidationError);
    // Prize share carrying a money amount
    await expect(
      addAgreementTerm(p, alphaOps, agr, { kind: 'PrizeShareTeam', percentBps: 500, amountMinor: 100, currency: 'USD' } as never),
    ).rejects.toBeInstanceOf(ValidationError);
    // Milestone without its trigger label
    await expect(
      addAgreementTerm(p, alphaOps, agr, { kind: 'Milestone', amountMinor: 100_000, currency: 'USD' } as never),
    ).rejects.toBeInstanceOf(ValidationError);
    // a valid milestone WITH a trigger succeeds
    const ms = await addAgreementTerm(p, alphaOps, agr, { kind: 'Milestone', amountMinor: 100_000, currency: 'USD', label: 'Reach playoffs' } as never);
    expect(ms).toMatchObject({ kind: 'Milestone', label: 'Reach playoffs' });
  });

  it('write gate: only owner/operations may manage terms (finance can VIEW but not write)', async () => {
    const agr = await addAgreement(await addPerson('Gate Tester'));
    await addAgreementTerm(p, alphaOps, agr, { kind: 'Salary', amountMinor: 100_000, currency: 'SAR' } as never);

    await expect(addAgreementTerm(p, alphaFinance, agr, { kind: 'Salary', amountMinor: 1, currency: 'SAR' } as never)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(addAgreementTerm(p, alphaVisitor, agr, { kind: 'Salary', amountMinor: 1, currency: 'SAR' } as never)).rejects.toBeInstanceOf(ForbiddenError);
    // finance CAN read the terms
    expect(await listAgreementTerms(p, alphaFinance, agr)).toHaveLength(1);
  });

  it('read gate: legal reads agreements WITHOUT terms (canViewFinancials denied); visitor denied entirely', async () => {
    const agr = await addAgreement(await addPerson('Read Tester'));
    await addAgreementTerm(p, alphaOps, agr, { kind: 'Salary', amountMinor: 100_000, currency: 'USD' } as never);

    // legal can read the agreement itself…
    expect(await p.reads.forActor(alphaLegal).getAgreementById(agr)).toBeTruthy();
    // …but the financial TERMS endpoint is a section-level denial (fail-closed)
    await expect(listAgreementTerms(p, alphaLegal, agr)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listAgreementTerms(p, alphaVisitor, agr)).rejects.toBeInstanceOf(ForbiddenError);
    // owner/finance may view
    expect(await listAgreementTerms(p, alphaOwner, agr)).toHaveLength(1);
  });

  it('terms may only be changed on an ACTIVE agreement (terminated = frozen record)', async () => {
    const agr = await addAgreement(await addPerson('Freeze Tester'));
    const t = await addAgreementTerm(p, alphaOps, agr, { kind: 'Salary', amountMinor: 100_000, currency: 'USD' } as never);
    await terminate(agr);

    await expect(addAgreementTerm(p, alphaOps, agr, { kind: 'PerformanceBonus', amountMinor: 5000, currency: 'USD' } as never)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(updateAgreementTerm(p, alphaOps, agr, t.termId, { expectedVersion: t.version, amountMinor: 1, currency: 'USD' } as never)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(removeAgreementTerm(p, alphaOps, agr, t.termId, t.version)).rejects.toBeInstanceOf(ConflictError);
    // the term is still readable on the terminated agreement
    expect(await listAgreementTerms(p, alphaOwner, agr)).toHaveLength(1);
  });

  it('is tenant-isolated (RLS): another tenant cannot see or reach the agreement/terms', async () => {
    const agr = await addAgreement(await addPerson('Iso Tester'));
    await addAgreementTerm(p, alphaOps, agr, { kind: 'Salary', amountMinor: 100_000, currency: 'USD' } as never);
    // bravo owner: the agreement is invisible → NotFound before any terms are served
    await expect(listAgreementTerms(p, bravoOwner, agr)).rejects.toBeInstanceOf(NotFoundError);
  });
});
