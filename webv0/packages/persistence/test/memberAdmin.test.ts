/**
 * memberAdmin.test.ts — Sprint 35 M2 evidence: governed member administration.
 *
 * Posture: c3_app STILL has zero table access to the directory — the
 * SECURITY DEFINER gateways are its only member surface, and they fail closed
 * without tenant context. Semantics: bind-once identity, self-administration
 * refusal, last-active-owner protection, shared-vs-sole deactivation (Phase-E1
 * exactly), tenant-scoped reads. Plus one full governed chain through the real
 * use-cases: submit (operations) → review/approve (owner) → execute (owner) →
 * member live + same-transaction audit trail.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import type { Actor } from '@c3web/domain';
import {
  submitMemberChange,
  beginReview,
  approveApproval,
  executeApproval,
  type Persistence,
} from '@c3web/application';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { createPersistence, type PersistenceHandle } from '../src/index';

let db: TestDatabase;
let p: PersistenceHandle;

const actor = (tenantId: string, email: string, role: string): Actor =>
  ({ userId: '00000000-0000-0000-0000-0000000000ff', identity: email, displayName: email, role: role as Actor['role'], tenantId });

/** Run fn as c3_app inside a tenant-scoped transaction (direct gateway access). */
async function asApp<T>(tenantId: string | null, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: db.appUrl, options: '-c client_encoding=UTF8' });
  await c.connect();
  try {
    await c.query('BEGIN');
    if (tenantId) await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await c.end();
  }
}

let alphaId: string;
let bravoId: string;
let alphaOwner: Actor;
let alphaOps: Actor;

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
      { key: 'owner', email: 'owner@a.com', displayName: 'Owner A', role: 'owner', entra: { tid: 't', oid: 'oid-owner-a' } },
      { key: 'ops', email: 'ops@a.com', displayName: 'Ops A', role: 'operations', entra: { tid: 't', oid: 'oid-ops-a' } },
    ],
  });
  const bravo = await db.seedTenant({
    slug: 'bravo',
    users: [{ key: 'owner', email: 'owner@b.com', displayName: 'Owner B', role: 'owner', entra: { tid: 't', oid: 'oid-owner-b' } }],
  });
  alphaId = alpha.tenantId;
  bravoId = bravo.tenantId;
  alphaOwner = actor(alphaId, 'owner@a.com', 'owner');
  alphaOps = actor(alphaId, 'ops@a.com', 'operations');
});

describe('posture: the gateways are the ONLY member surface for c3_app', () => {
  it('c3_app still has zero direct table access to the directory', async () => {
    await asApp(alphaId, async (c) => {
      await expect(c.query(`INSERT INTO app_user (email, display_name) VALUES ('evil@x.com','evil')`)).rejects.toThrow(/permission denied/i);
    });
    await asApp(alphaId, async (c) => {
      await expect(c.query(`UPDATE app_user SET is_active=false`)).rejects.toThrow(/permission denied/i);
    });
    await asApp(alphaId, async (c) => {
      await expect(c.query(`SELECT * FROM tenant_membership`)).rejects.toThrow(/permission denied/i);
    });
    await asApp(alphaId, async (c) => {
      await expect(c.query(`DELETE FROM role_assignment`)).rejects.toThrow(/permission denied/i);
    });
  });

  it('every gateway fails closed without tenant context', async () => {
    await asApp(null, async (c) => {
      await expect(c.query(`SELECT * FROM member_list()`)).rejects.toThrow(/C3E:TENANT_CONTEXT_MISSING/);
    });
    await asApp(null, async (c) => {
      await expect(
        c.query(`SELECT member_provision('x@x.com','X','visitor','entra','t','oid-x')`),
      ).rejects.toThrow(/C3E:TENANT_CONTEXT_MISSING/);
    });
  });

  it('member_list is tenant-scoped: alpha cannot see bravo members', async () => {
    const rows = await asApp(alphaId, async (c) => (await c.query('SELECT email FROM member_list()')).rows);
    const emails = rows.map((r) => r.email);
    expect(emails).toContain('owner@a.com');
    expect(emails).not.toContain('owner@b.com');
  });
});

describe('gateway guards (SQL-enforced invariants)', () => {
  it('bind-once: the same identity with a different email is refused', async () => {
    await asApp(alphaId, async (c) => {
      await expect(
        c.query(`SELECT member_provision('different@x.com','X','visitor','entra','t','oid-owner-b')`),
      ).rejects.toThrow(/C3E:IDENTITY_ALREADY_BOUND/);
    });
  });

  it('provisioning an existing member of this tenant is a conflict', async () => {
    await asApp(alphaId, async (c) => {
      await expect(
        c.query(`SELECT member_provision('owner@a.com','Owner A','owner','entra','t','oid-owner-a')`),
      ).rejects.toThrow(/C3E:CONFLICT: already a member/);
    });
  });

  it('self-administration is blocked in SQL regardless of the caller', async () => {
    const ownerId = await asApp(alphaId, async (c) =>
      (await c.query(`SELECT user_id FROM member_list() WHERE email='owner@a.com'`)).rows[0].user_id,
    );
    await asApp(alphaId, async (c) => {
      await expect(c.query(`SELECT member_set_role($1::uuid,'visitor','owner@a.com')`, [ownerId])).rejects.toThrow(
        /C3E:SELF_ADMINISTRATION_BLOCKED/,
      );
    });
    await asApp(alphaId, async (c) => {
      await expect(c.query(`SELECT member_set_active($1::uuid,false,'owner@a.com')`, [ownerId])).rejects.toThrow(
        /C3E:SELF_ADMINISTRATION_BLOCKED/,
      );
    });
  });

  it('the last active owner can be neither demoted nor deactivated', async () => {
    const ownerId = await asApp(alphaId, async (c) =>
      (await c.query(`SELECT user_id FROM member_list() WHERE email='owner@a.com'`)).rows[0].user_id,
    );
    await asApp(alphaId, async (c) => {
      await expect(c.query(`SELECT member_set_role($1::uuid,'operations','ops@a.com')`, [ownerId])).rejects.toThrow(
        /C3E:LAST_OWNER_PROTECTED/,
      );
    });
    await asApp(alphaId, async (c) => {
      await expect(c.query(`SELECT member_set_active($1::uuid,false,'ops@a.com')`, [ownerId])).rejects.toThrow(
        /C3E:LAST_OWNER_PROTECTED/,
      );
    });
  });

  it('deactivation implements Phase-E1: sole-tenant flips is_active; shared removes THIS membership only', async () => {
    // Make ops@a.com a shared user (also a bravo member).
    const opsId = await asApp(alphaId, async (c) =>
      (await c.query(`SELECT user_id FROM member_list() WHERE email='ops@a.com'`)).rows[0].user_id,
    );
    await asApp(bravoId, async (c) => {
      await c.query(`SELECT member_provision('ops@a.com','Ops A','visitor','entra','t','oid-ops-a')`);
    });

    // Shared: deactivating in alpha removes only alpha's membership.
    const mode = await asApp(alphaId, async (c) =>
      (await c.query(`SELECT member_set_active($1::uuid,false,'owner@a.com') AS mode`, [opsId])).rows[0].mode,
    );
    expect(mode).toBe('membership-removed');
    const bravoStill = await asApp(bravoId, async (c) =>
      (await c.query(`SELECT is_active FROM member_list() WHERE email='ops@a.com'`)).rows,
    );
    expect(bravoStill).toHaveLength(1);
    expect(bravoStill[0].is_active).toBe(true); // untouched elsewhere

    // Sole: bravo (now their only tenant) deactivation flips is_active.
    const mode2 = await asApp(bravoId, async (c) =>
      (await c.query(`SELECT member_set_active($1::uuid,false,'owner@b.com') AS mode`, [opsId])).rows[0].mode,
    );
    expect(mode2).toBe('deactivated-sole');

    // Reactivate restores.
    const mode3 = await asApp(bravoId, async (c) =>
      (await c.query(`SELECT member_set_active($1::uuid,true,'owner@b.com') AS mode`, [opsId])).rows[0].mode,
    );
    expect(mode3).toBe('reactivated');
  });
});

describe('full governed chain (use-cases end to end)', () => {
  it('operations submits ProvisionMember; owner approves + executes; member live + audited in ONE transaction', async () => {
    const P: Persistence = p;
    const approval = await submitMemberChange(P, alphaOps, {
      payload: {
        operationType: 'ProvisionMember',
        input: {
          email: 'new.member@a.com',
          displayName: 'New Member',
          role: 'management',
          identity: { provider: 'entra', issuerTenantId: 't', subject: 'oid-new-member' },
        },
      },
      reason: 'Onboarding the management lead',
    });
    expect(approval.status).toBe('Submitted');
    expect(approval.targetPersonId).toBe('N/A-MEMBER');

    const inReview = await beginReview(P, alphaOwner, approval.approvalId, approval.version);
    const approved = await approveApproval(P, alphaOwner, inReview.approvalId, inReview.version);
    const result = await executeApproval(P, alphaOwner, approved.approvalId, approved.version);
    expect(result.approval.status).toBe('Executed');
    expect(result.person).toBeNull();

    // The member is live with the requested role.
    const members = await p.reads.forActor(alphaOwner).listMembers();
    const created = members.find((m) => m.email === 'new.member@a.com');
    expect(created).toMatchObject({ role: 'management', isActive: true });

    // Same-transaction audit truth: MemberProvisioned on the Member entity.
    const audit = await p.reads.forActor(alphaOwner).listAuditEventsForEntity('Member', created!.userId);
    expect(audit.some((e) => e.action === 'MemberProvisioned' && e.actor === 'owner@a.com')).toBe(true);
  });

  it('the requester may not target their own account at submit', async () => {
    await expect(
      submitMemberChange(p, alphaOps, {
        payload: {
          operationType: 'DeactivateMember',
          input: { targetUserId: '6f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b', email: 'ops@a.com' },
        },
      }),
    ).rejects.toThrow(/may not/i);
  });

  it('a guard violation at execute records a truthful ExecutionFailed (no partial change)', async () => {
    // ops submits deactivation of the LAST owner; owner approves; execution
    // must fail on the SQL guard and record ExecutionFailed.
    const ownerId = await asApp(alphaId, async (c) =>
      (await c.query(`SELECT user_id FROM member_list() WHERE email='owner@a.com'`)).rows[0].user_id,
    );
    const approval = await submitMemberChange(p, alphaOps, {
      payload: { operationType: 'DeactivateMember', input: { targetUserId: ownerId, email: 'owner@a.com' } },
    });
    const inReview = await beginReview(p, alphaOwner, approval.approvalId, approval.version);
    // The owner may approve (submitter is ops), but execution hits BOTH SQL
    // guards: the target is the executor (self) AND the last active owner.
    const approved = await approveApproval(p, alphaOwner, inReview.approvalId, inReview.version);
    // Must surface as a MAPPED domain error (the ORM wraps pg errors in a
    // cause chain — the adapter walks it), not a generic 500-shaped throw.
    await expect(executeApproval(p, alphaOwner, approved.approvalId, approved.version)).rejects.toMatchObject({
      code: expect.stringMatching(/^(SELF_ADMINISTRATION_BLOCKED|LAST_OWNER_PROTECTED)$/),
    });

    const after = await p.reads.forActor(alphaOwner).getApprovalById(approval.approvalId);
    expect(after?.status).toBe('ExecutionFailed');
    // No partial change: the owner is still active.
    const owner = await asApp(alphaId, async (c) =>
      (await c.query(`SELECT is_active FROM member_list() WHERE email='owner@a.com'`)).rows[0],
    );
    expect(owner.is_active).toBe(true);
  });
});
