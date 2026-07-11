/**
 * missions.test.ts — Sprint 39 M2 evidence against a REAL PostgreSQL. The
 * capstone guard matrix:
 *   - shell: direct-audited create/update/deactivate, changed-fields-only
 *     images, stored-row date coherence, stale-version zero-change, authz;
 *   - participants: the full governed chain, duplicate-PENDING refused at
 *     submit, duplicate-ACTIVE refused at submit AND authoritatively at
 *     execute (truthful ExecutionFailed, one row, untouched), reactivation
 *     reusing the SAME row, removal guards (incl. removal from a retired
 *     shell), and RLS isolation.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor, AddPersonInput, Approval } from '@c3web/domain';
import {
  createMission,
  updateMission,
  deactivateMission,
  submitAddMissionParticipant,
  submitRemoveMissionParticipant,
  setParticipantPerDiem,
  submitAddPerson,
  beginReview,
  approveApproval,
  executeApproval,
  listMissionParticipants,
  type ExecuteResult,
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
  alphaVisitor = actor(alphaId, 'visitor@a.com', 'visitor');
  bravoOwner = actor(bravoId, 'owner@b.com', 'owner');
});

describe('mission shell (direct-audited, the equipment pattern)', () => {
  it('create → update (changed-fields-only images, same-day end legal) → deactivate', async () => {
    const m = await createMission(p, alphaOps, { name: 'Spring Invitational', gameTitle: 'VALORANT', startsOn: '2026-08-01' });
    expect(m).toMatchObject({ missionId: 'MSN-0001', isActive: true, version: 0, startsOn: '2026-08-01', endsOn: null });

    const updated = await updateMission(p, alphaOps, m.missionId, { expectedVersion: 0, endsOn: '2026-08-01', notes: 'One-day event' });
    expect(updated.endsOn).toBe('2026-08-01'); // same-day missions legal, byte-for-byte
    expect(updated.version).toBe(1);

    const audit = await p.reads.forActor(alphaOwner).listAuditEventsForEntity('Mission', m.missionId);
    const upd = audit.find((e) => e.action === 'MissionUpdated')!;
    expect(upd.before).toEqual({ endsOn: null, notes: null });
    expect(upd.after).toEqual({ endsOn: '2026-08-01', notes: 'One-day event' });
    expect('name' in (upd.after ?? {})).toBe(false); // unchanged fields stay out

    const retired = await deactivateMission(p, alphaOwner, m.missionId, updated.version);
    expect(retired.isActive).toBe(false);
    const audit2 = await p.reads.forActor(alphaOwner).listAuditEventsForEntity('Mission', m.missionId);
    expect(audit2.map((e) => e.action)).toEqual(['MissionCreated', 'MissionUpdated', 'MissionDeactivated']);
  });

  it('date coherence holds against the STORED row for one-sided patches (app + DB CHECK)', async () => {
    const m = await createMission(p, alphaOps, { name: 'Bootcamp', startsOn: '2026-08-10', endsOn: '2026-08-20' });
    // Moving the start past the stored end is refused even though the patch alone looks fine.
    await expect(updateMission(p, alphaOps, m.missionId, { expectedVersion: 0, startsOn: '2026-09-01' })).rejects.toThrow(/on or after/i);
    // Moving the end before the stored start likewise.
    await expect(updateMission(p, alphaOps, m.missionId, { expectedVersion: 0, endsOn: '2026-08-01' })).rejects.toThrow(/on or after/i);
    // Clearing the end is always coherent.
    const cleared = await updateMission(p, alphaOps, m.missionId, { expectedVersion: 0, endsOn: null });
    expect(cleared.endsOn).toBeNull();
    // The DB CHECK is armed underneath the application guard.
    await expect(db.adminQuery(`UPDATE mission SET ends_on = '2026-01-01' WHERE mission_id = 'MSN-0001'`)).rejects.toThrow(
      /mission_dates_coherent/,
    );
  });

  it('stale version refuses with zero change; only owner/operations manage the shell', async () => {
    const m = await createMission(p, alphaOwner, { name: 'LAN Finals', startsOn: '2026-10-01' });
    await updateMission(p, alphaOwner, m.missionId, { expectedVersion: 0, name: 'LAN Finals 2026' });
    await expect(updateMission(p, alphaOwner, m.missionId, { expectedVersion: 0, name: 'LAN Finals (stale)' })).rejects.toThrow(
      /modified concurrently/i,
    );
    expect((await p.reads.forActor(alphaOwner).getMissionById(m.missionId))?.name).toBe('LAN Finals 2026');

    await expect(createMission(p, alphaVisitor, { name: 'X', startsOn: '2026-08-01' })).rejects.toThrow(/may not manage missions/i);
    await expect(deactivateMission(p, alphaVisitor, m.missionId, 1)).rejects.toThrow(/may not manage missions/i);
  });
});

describe('per-diem on a participant (Finance S2, direct-audited)', () => {
  it('owner/ops set then clear a daily rate; it is audited; visitor is refused', async () => {
    const personId = await addPerson('Traveller');
    const m = await createMission(p, alphaOps, { name: 'Autumn Major', startsOn: '2026-09-12', endsOn: '2026-09-21' });
    await governedExecute(await submitAddMissionParticipant(p, alphaOps, { input: { missionId: m.missionId, personId, role: 'Player' } }));

    // 250.00 SAR/day
    const set = await setParticipantPerDiem(p, alphaOps, { missionId: m.missionId, personId, perDiemAmountMinor: 25_000, perDiemCurrency: 'SAR', expectedVersion: 0 });
    expect(set).toMatchObject({ perDiemAmountMinor: 25_000, perDiemCurrency: 'SAR' });
    expect(set.version).toBe(1); // HARDEN-2 M-03: every participant write bumps the token

    const [seen] = await listMissionParticipants(p, alphaOwner, m.missionId);
    expect(seen).toMatchObject({ perDiemAmountMinor: 25_000, perDiemCurrency: 'SAR' });

    // HARDEN-2 M-03: a stale caller (still holding version 0) is refused, never merged.
    await expect(
      setParticipantPerDiem(p, alphaOps, { missionId: m.missionId, personId, perDiemAmountMinor: 99_900, perDiemCurrency: 'USD', expectedVersion: 0 }),
    ).rejects.toThrow(/modified concurrently/i);

    const cleared = await setParticipantPerDiem(p, alphaOps, { missionId: m.missionId, personId, perDiemAmountMinor: null, perDiemCurrency: null, expectedVersion: set.version });
    expect(cleared.perDiemAmountMinor).toBeNull();
    expect(cleared.perDiemCurrency).toBeNull();

    await expect(
      setParticipantPerDiem(p, alphaVisitor, { missionId: m.missionId, personId, perDiemAmountMinor: 100, perDiemCurrency: 'USD', expectedVersion: cleared.version }),
    ).rejects.toThrow(/may not manage missions/i);

    const audit = await p.reads.forActor(alphaOwner).listAuditEventsForEntity('MissionParticipant', `${m.missionId}/${personId}`);
    expect(audit.filter((a) => a.action === 'MissionParticipantPerDiemSet')).toHaveLength(2); // set + clear
  });

  it('setting per-diem on a non-participant is refused', async () => {
    const m = await createMission(p, alphaOps, { name: 'Empty', startsOn: '2026-09-12', endsOn: '2026-09-21' });
    await expect(
      setParticipantPerDiem(p, alphaOps, { missionId: m.missionId, personId: 'PER-9999', perDiemAmountMinor: 100, perDiemCurrency: 'USD', expectedVersion: 0 }),
    ).rejects.toThrow(/participant/i);
  });
});

describe('governed participant membership (the Set-D guard matrix)', () => {
  it('full chain: submit (ops) → review/approve → execute (owner) lands an audited active membership', async () => {
    const personId = await addPerson('Star Player');
    const m = await createMission(p, alphaOps, { name: 'Spring Invitational', startsOn: '2026-08-01' });

    const a = await submitAddMissionParticipant(p, alphaOps, { input: { missionId: m.missionId, personId, role: 'Player' } });
    expect(a).toMatchObject({ operationType: 'AddMissionParticipant', targetPersonId: personId, targetId: m.missionId, status: 'Submitted' });

    const res = await governedExecute(a);
    expect(res.approval.status).toBe('Executed');
    expect(res.participant).toMatchObject({ missionId: m.missionId, personId, role: 'Player', isActive: true, personName: 'Star Player' });

    const roster = await listMissionParticipants(p, alphaOwner, m.missionId);
    expect(roster).toHaveLength(1);
    const audit = await p.reads.forActor(alphaOwner).listAuditEventsForEntity('MissionParticipant', `${m.missionId}/${personId}`);
    expect(audit.map((e) => e.action)).toEqual(['MissionParticipantAdded']);
    expect(audit[0]!.before).toBeNull(); // first-ever membership
  });

  it('duplicate-PENDING refused at submit for BOTH operations; zero new approvals', async () => {
    const personId = await addPerson('Pending Pair');
    const m = await createMission(p, alphaOps, { name: 'M', startsOn: '2026-08-01' });
    await submitAddMissionParticipant(p, alphaOps, { input: { missionId: m.missionId, personId, role: 'Player' } });

    const before = (await p.reads.forActor(alphaOwner).listApprovals()).length;
    await expect(
      submitAddMissionParticipant(p, alphaOps, { input: { missionId: m.missionId, personId, role: 'Coach' } }),
    ).rejects.toThrow(/open approval already exists/i);
    const after = (await p.reads.forActor(alphaOwner).listApprovals()).length;
    expect(after).toBe(before);
  });

  it('duplicate-ACTIVE refused at submit once the pair is live', async () => {
    const personId = await addPerson('Active Pair');
    const m = await createMission(p, alphaOps, { name: 'M', startsOn: '2026-08-01' });
    await governedExecute(await submitAddMissionParticipant(p, alphaOps, { input: { missionId: m.missionId, personId, role: 'Player' } }));

    await expect(
      submitAddMissionParticipant(p, alphaOps, { input: { missionId: m.missionId, personId, role: 'Player' } }),
    ).rejects.toThrow(/already an active participant/i);
  });

  it('duplicate-ACTIVE refused authoritatively at EXECUTE: truthful ExecutionFailed, one row, untouched', async () => {
    const personId = await addPerson('Raced Pair');
    const m = await createMission(p, alphaOps, { name: 'M', startsOn: '2026-08-01' });
    await governedExecute(await submitAddMissionParticipant(p, alphaOps, { input: { missionId: m.missionId, personId, role: 'Player' } }));

    // Simulate the race the submit guard cannot see: an approval for the pair
    // that reached Approved while the pair went active (crafted directly —
    // exactly what two racing submissions would produce).
    const crafted = await p.writes.transaction(alphaOps, async (tx) => {
      const seq = await tx.allocateSequence('approval');
      return tx.insertApproval({
        approvalId: `APR-${String(seq).padStart(4, '0')}`,
        operationType: 'AddMissionParticipant',
        targetPersonId: personId,
        targetId: m.missionId,
        reason: null,
        payload: { operationType: 'AddMissionParticipant', input: { missionId: m.missionId, personId, role: 'Substitute' } },
        submittedBy: alphaOps.identity,
      });
    });
    const inReview = await beginReview(p, alphaOwner, crafted.approvalId, crafted.version);
    const approved = await approveApproval(p, alphaOwner, inReview.approvalId, inReview.version);

    await expect(executeApproval(p, alphaOwner, approved.approvalId, approved.version)).rejects.toThrow(
      /already an active participant/i,
    );

    const failed = await p.reads.forActor(alphaOwner).getApprovalById(crafted.approvalId);
    expect(failed?.status).toBe('ExecutionFailed');
    expect(failed?.executionError).toMatch(/already an active participant/i);
    const roster = await listMissionParticipants(p, alphaOwner, m.missionId);
    expect(roster).toHaveLength(1);
    expect(roster[0]!.role).toBe('Player'); // the live membership is untouched
  });

  it('an inactive mission refuses new participants at submit AND at execute', async () => {
    const personId = await addPerson('Late Joiner');
    const m = await createMission(p, alphaOps, { name: 'M', startsOn: '2026-08-01' });

    // Approve an add, then retire the shell BEFORE execution: the execute-time
    // re-check catches what submit could not.
    const a = await submitAddMissionParticipant(p, alphaOps, { input: { missionId: m.missionId, personId, role: 'Player' } });
    const inReview = await beginReview(p, alphaOwner, a.approvalId, a.version);
    const approved = await approveApproval(p, alphaOwner, inReview.approvalId, inReview.version);
    await deactivateMission(p, alphaOwner, m.missionId, 0);
    await expect(executeApproval(p, alphaOwner, approved.approvalId, approved.version)).rejects.toThrow(/inactive mission/i);
    expect((await p.reads.forActor(alphaOwner).getApprovalById(a.approvalId))?.status).toBe('ExecutionFailed');
    expect(await listMissionParticipants(p, alphaOwner, m.missionId)).toHaveLength(0);

    // And a fresh submit against the retired shell is refused at the door.
    await expect(
      submitAddMissionParticipant(p, alphaOps, { input: { missionId: m.missionId, personId, role: 'Player' } }),
    ).rejects.toThrow(/inactive mission/i);
  });

  it('remove → reactivate reuses THE SAME row (never a second one), with honest images', async () => {
    const personId = await addPerson('Returning Player');
    const m = await createMission(p, alphaOps, { name: 'M', startsOn: '2026-08-01' });
    await governedExecute(await submitAddMissionParticipant(p, alphaOps, { input: { missionId: m.missionId, personId, role: 'Player' } }));

    const removed = await governedExecute(
      await submitRemoveMissionParticipant(p, alphaOps, { input: { missionId: m.missionId, personId } }),
    );
    expect(removed.participant).toMatchObject({ isActive: false });

    const back = await governedExecute(
      await submitAddMissionParticipant(p, alphaOps, { input: { missionId: m.missionId, personId, role: 'Coach' } }),
    );
    expect(back.participant).toMatchObject({ isActive: true, role: 'Coach' });

    // ONE row for the pair across the whole lifecycle — the SP APR-0065 semantics.
    const rows = await db.adminQuery(
      `SELECT count(*)::int AS n FROM mission_participant WHERE mission_id = '${m.missionId}' AND person_id = '${personId}'`,
    );
    expect((rows as Array<{ n: number }>)[0]!.n).toBe(1);

    const audit = await p.reads.forActor(alphaOwner).listAuditEventsForEntity('MissionParticipant', `${m.missionId}/${personId}`);
    expect(audit.map((e) => e.action)).toEqual(['MissionParticipantAdded', 'MissionParticipantRemoved', 'MissionParticipantAdded']);
    expect(audit[2]!.before).toEqual({ isActive: false, role: 'Player' }); // reactivation shows the dormant row
  });

  it('remove refusals: unknown pair, already-inactive pair; removal from a RETIRED shell still works', async () => {
    const personId = await addPerson('Cleanup Case');
    const m = await createMission(p, alphaOps, { name: 'M', startsOn: '2026-08-01' });
    await expect(
      submitRemoveMissionParticipant(p, alphaOps, { input: { missionId: m.missionId, personId } }),
    ).rejects.toThrow(/not found/i);

    await governedExecute(await submitAddMissionParticipant(p, alphaOps, { input: { missionId: m.missionId, personId, role: 'Player' } }));
    await deactivateMission(p, alphaOwner, m.missionId, 0);

    // Cleanup is never trapped by a deactivated shell.
    const removed = await governedExecute(
      await submitRemoveMissionParticipant(p, alphaOps, { input: { missionId: m.missionId, personId } }),
    );
    expect(removed.participant?.isActive).toBe(false);

    await expect(
      submitRemoveMissionParticipant(p, alphaOps, { input: { missionId: m.missionId, personId } }),
    ).rejects.toThrow(/not an active participant/i);
  });

  it('missions and participants are tenant-isolated (RLS)', async () => {
    const personId = await addPerson('Isolated Player');
    const m = await createMission(p, alphaOps, { name: 'Alpha-only', startsOn: '2026-08-01' });
    await governedExecute(await submitAddMissionParticipant(p, alphaOps, { input: { missionId: m.missionId, personId, role: 'Player' } }));

    expect(await p.reads.forActor(bravoOwner).listMissions()).toHaveLength(0);
    expect(await p.reads.forActor(bravoOwner).getMissionById(m.missionId)).toBeNull();
    await expect(listMissionParticipants(p, bravoOwner, m.missionId)).rejects.toThrow(/not found/i);
    expect(await p.reads.forActor(alphaOwner).listMissions()).toHaveLength(1);
  });
});
