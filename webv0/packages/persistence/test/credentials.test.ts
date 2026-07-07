/**
 * credentials.test.ts — Sprint 36 C2 evidence against a REAL PostgreSQL.
 * Covers: the full governed AddCredential chain (submit → review → execute →
 * credential live + audited), BYTE-FOR-BYTE date roundtrip (the CP date-swap
 * guarantee at the persistence layer), execute idempotency, the
 * DeactivateCredential chain + already-inactive refusal, person/credential
 * mismatch refusal, the DB-level expiry constraint, and RLS tenant isolation.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import type { Actor, AddPersonInput } from '@c3web/domain';
import {
  submitAddCredential,
  submitDeactivateCredential,
  submitAddPerson,
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
let bravoId: string;
let alphaOwner: Actor;
let alphaOps: Actor;
let bravoOwner: Actor;

async function chain(executing: Actor, approvalId: string, version: number) {
  const inReview = await beginReview(p, executing, approvalId, version);
  const approved = await approveApproval(p, executing, inReview.approvalId, inReview.version);
  return executeApproval(p, executing, approved.approvalId, approved.version);
}

/** Governed AddPerson so credentials have a real owner. */
async function addPerson(fullName: string): Promise<string> {
  const a = await submitAddPerson(p, alphaOps, { input: { fullName } as AddPersonInput });
  const res = await chain(alphaOwner, a.approvalId, a.version);
  return res.person!.personId;
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
  bravoOwner = actor(bravoId, 'owner@b.com', 'owner');
});

describe('governed AddCredential chain', () => {
  it('creates the credential on execute with a BYTE-FOR-BYTE date roundtrip', async () => {
    const personId = await addPerson('Jordan Reyes');
    const a = await submitAddCredential(p, alphaOps, {
      input: { personId, credentialType: 'Coaching License A', issuer: 'Federation', issuedOn: '2026-01-02', expiresOn: '2031-12-30' },
      reason: 'Season requirement',
    });
    expect(a.status).toBe('Submitted');
    expect(a.targetPersonId).toBe(personId);

    const res = await chain(alphaOwner, a.approvalId, a.version);
    expect(res.approval.status).toBe('Executed');
    expect(res.person).toBeNull();
    expect(res.credential).toMatchObject({
      credentialId: 'CRED-0001',
      personId,
      credentialType: 'Coaching License A',
      issuedOn: '2026-01-02', // exact — no swap, no shift, no timezone
      expiresOn: '2031-12-30',
      isActive: true,
    });

    // Read-side roundtrip stays byte-identical too.
    const read = await p.reads.forActor(alphaOwner).getCredentialById('CRED-0001');
    expect(read?.issuedOn).toBe('2026-01-02');
    expect(read?.expiresOn).toBe('2031-12-30');

    // Same-transaction audit truth.
    const audit = await p.reads.forActor(alphaOwner).listAuditEventsForEntity('Credential', 'CRED-0001');
    expect(audit.some((e) => e.action === 'CredentialCreated' && e.after?.issuedOn === '2026-01-02')).toBe(true);

    // Per-person read surface.
    const forPerson = await p.reads.forActor(alphaOwner).listCredentialsForPerson(personId);
    expect(forPerson).toHaveLength(1);
  });

  it('re-execution is idempotent: one credential, same result returned', async () => {
    const personId = await addPerson('Solo Person');
    const a = await submitAddCredential(p, alphaOps, {
      input: { personId, credentialType: 'License', issuedOn: '2026-02-01' },
    });
    const res = await chain(alphaOwner, a.approvalId, a.version);
    const again = await executeApproval(p, alphaOwner, a.approvalId, res.approval.version);
    expect(again.idempotent).toBe(true);
    expect(again.credential?.credentialId).toBe(res.credential?.credentialId);
    expect(await p.reads.forActor(alphaOwner).listCredentials()).toHaveLength(1);
  });

  it('submit refuses an unknown person', async () => {
    await expect(
      submitAddCredential(p, alphaOps, { input: { personId: 'PER-9999', credentialType: 'X', issuedOn: '2026-01-01' } }),
    ).rejects.toThrow(/Person not found/i);
  });
});

describe('governed DeactivateCredential chain', () => {
  it('deactivates on execute; a repeat submission is refused at the door', async () => {
    const personId = await addPerson('Cred Holder');
    const add = await submitAddCredential(p, alphaOps, {
      input: { personId, credentialType: 'License', issuedOn: '2026-01-01', expiresOn: '2027-01-01' },
    });
    const created = await chain(alphaOwner, add.approvalId, add.version);
    const credId = created.credential!.credentialId;

    const deact = await submitDeactivateCredential(p, alphaOps, { input: { credentialId: credId, personId } });
    const res = await chain(alphaOwner, deact.approvalId, deact.version);
    expect(res.credential?.isActive).toBe(false);

    const audit = await p.reads.forActor(alphaOwner).listAuditEventsForEntity('Credential', credId);
    expect(audit.some((e) => e.action === 'CredentialDeactivated')).toBe(true);

    await expect(
      submitDeactivateCredential(p, alphaOps, { input: { credentialId: credId, personId } }),
    ).rejects.toThrow(/already inactive/i);
  });

  it('submit refuses a person/credential mismatch', async () => {
    const personId = await addPerson('Real Owner');
    const otherId = await addPerson('Other Person');
    const add = await submitAddCredential(p, alphaOps, {
      input: { personId, credentialType: 'License', issuedOn: '2026-01-01' },
    });
    const created = await chain(alphaOwner, add.approvalId, add.version);
    await expect(
      submitDeactivateCredential(p, alphaOps, { input: { credentialId: created.credential!.credentialId, personId: otherId } }),
    ).rejects.toThrow(/does not belong/i);
  });
});

describe('database-level constraints and isolation', () => {
  it('the DB refuses expiry on/before issue even if the app layer were bypassed', async () => {
    const personId = await addPerson('Constraint Target');
    const admin = new Client({ connectionString: db.adminUrl });
    await admin.connect();
    try {
      // FORCE RLS applies to the owner too — set the tenant context first.
      await admin.query('BEGIN');
      await admin.query("SELECT set_config('app.tenant_id', $1, true)", [alphaId]);
      await expect(
        admin.query(
          `INSERT INTO credential (tenant_id, credential_id, person_id, credential_type, issued_on, expires_on, created_by_approval_id)
           VALUES ($1,'CRED-9999',$2,'X','2026-05-01','2026-05-01','APR-0001')`,
          [alphaId, personId],
        ),
      ).rejects.toThrow(/credential_expiry_after_issue/);
      await admin.query('ROLLBACK');
    } finally {
      await admin.end();
    }
  });

  it('credentials are tenant-isolated (RLS): bravo sees nothing of alpha', async () => {
    const personId = await addPerson('Isolated Person');
    const add = await submitAddCredential(p, alphaOps, {
      input: { personId, credentialType: 'License', issuedOn: '2026-01-01' },
    });
    await chain(alphaOwner, add.approvalId, add.version);

    expect(await p.reads.forActor(bravoOwner).listCredentials()).toHaveLength(0);
    expect(await p.reads.forActor(bravoOwner).getCredentialById('CRED-0001')).toBeNull();
    expect(await p.reads.forActor(alphaOwner).listCredentials()).toHaveLength(1);
  });
});
