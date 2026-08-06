/**
 * commsSeatFreshness.test.ts — CR-037 (Sweep 06): the WRITE re-derives its seat
 * INSIDE the transaction, so a stale pre-gate cannot admit a message.
 *
 * ⛔ THE DEFECT. `postThreadMessage` derived standing-room membership from a read
 * BEFORE the write transaction and never re-checked inside it. A
 * `removeFromRoom` committing in that window still admitted the message — the
 * pre-gate's answer was true when read and false when USED. RLS beneath is
 * tenant-only (0091), so nothing deeper catches it. CR-036's sibling one layer
 * down: one READS on a stale capability, this one WRITES on one.
 *
 * ⚖️ THE TEST MAKES THE WINDOW DETERMINISTIC instead of racing it: the removal
 * really commits, then a proxy hands `postThreadMessage` the SEATING THE
 * PRE-GATE WOULD HAVE SEEN before the removal. Every fact is genuine — the
 * room, the removal, the write path; only the pre-gate's answer is pinned to
 * the stale moment. The in-tx re-check is then the only thing standing, which
 * is exactly the claim under test.
 *
 * ⚖️ The sibling write path already practices this — the comms DOCUMENT post
 * re-checks entitlement/mission/thread INSIDE its tx ("the license or the room
 * may have moved"). CR-037 is this path lacking what its sibling has.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@c3web/domain';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import {
  createStandingRoom,
  inviteToRoom,
  postThreadMessage,
  removeFromRoom,
  type Persistence,
  type CommsThreadParticipantView,
} from '@c3web/application';
import { createPersistence, type PersistenceHandle } from '../src/index';

let db: TestDatabase;
let p: PersistenceHandle;
let admin: Actor;
let member: Actor;

beforeAll(async () => {
  db = await startTestDatabase();
  const seeded = await db.seedTenant({
    slug: 'seat-freshness',
    users: [
      { key: 'admin', email: 'admin@seat.test', displayName: 'Admin', role: 'owner' },
      { key: 'member', email: 'member@seat.test', displayName: 'Member', role: 'operations' },
    ],
  });
  await db.adminQuery(
    `INSERT INTO tenant_module_entitlement (tenant_id, module_key, state)
     VALUES ('${seeded.tenantId}', 'comms', 'active')
     ON CONFLICT (tenant_id, module_key) DO UPDATE SET state = 'active'`,
  );
  p = createPersistence({ appConnectionString: db.appUrl });
  const a = seeded.users.admin!;
  const m = seeded.users.member!;
  admin = { userId: a.userId, identity: a.email, displayName: a.displayName, role: 'owner', tenantId: seeded.tenantId };
  member = { userId: m.userId, identity: m.email, displayName: m.displayName, role: 'operations', tenantId: seeded.tenantId };
}, 180_000);

afterAll(async () => {
  await p?.close();
  await db?.stop();
});

/** `p`, with the pre-gate's seating read pinned to a chosen (stale) answer. */
function withStaleSeating(seating: CommsThreadParticipantView[]): Persistence {
  return {
    ...p,
    reads: {
      forActor: (a: Actor) => {
        const real = p.reads.forActor(a);
        return new Proxy(real, {
          get(target, prop, receiver) {
            if (prop === 'listCommsThreadParticipants') return async () => seating;
            return Reflect.get(target, prop, receiver);
          },
        });
      },
    },
  };
}

const msg = (body: string) => ({ body, links: [], clientMutationId: randomUUID() });

describe('⛔ CR-037 — a committed removal is binding on a write already past the pre-gate', () => {
  it('⛔ THE WINDOW: a stale seated-answer at the pre-gate must NOT admit the message', async () => {
    const room = await createStandingRoom(p, admin, 'War Room');
    await inviteToRoom(p, admin, room.threadId, member.userId);

    // The member's seat is REMOVED, committed, done.
    await removeFromRoom(p, admin, room.threadId, member.userId);

    // The pre-gate now answers from the STALE moment (member still seated) —
    // exactly what a pre-tx read races into. Only an in-tx re-check can refuse.
    const stale = withStaleSeating([
      { userId: admin.userId, role: 'admin', displayName: 'Admin' },
      { userId: member.userId, role: 'member', displayName: 'Member' },
    ]);
    await expect(postThreadMessage(stale, member, room.threadId, msg('posted through the window'))).rejects.toThrow(
      /not found/i,
    );

    // And nothing landed: the room's history carries no message from the window.
    const rows = await db.adminQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM comms_message WHERE thread_id = '${room.threadId}'`,
    );
    expect(rows[0]!.n).toBe(0);
  });

  it('⛳ a genuinely seated member still posts — the re-check refuses staleness, not membership', async () => {
    // The positive control (LAW 29): a guard hard-wired to refuse would pass the
    // test above. The same stale-pinned pre-gate, but the seat is REAL — the
    // in-tx re-check must agree with the truth, not echo the refusal.
    const room = await createStandingRoom(p, admin, 'Open Table');
    await inviteToRoom(p, admin, room.threadId, member.userId);
    const stale = withStaleSeating([
      { userId: admin.userId, role: 'admin', displayName: 'Admin' },
      { userId: member.userId, role: 'member', displayName: 'Member' },
    ]);
    const posted = await postThreadMessage(stale, member, room.threadId, msg('still seated, still heard'));
    expect(posted.body).toBe('still seated, still heard');
  });

  it('⛳ the DIRECT-thread arm is guarded by the same re-check shape', async () => {
    // A direct thread's seats cannot be removed today (no removal path exists),
    // so the live window is standing-room-shaped — but the guard is kind-scoped,
    // not path-scoped, and this pins the direct arm too: a pre-gate lying about
    // a seat the tx cannot find must not admit the message.
    const stale = withStaleSeating([{ userId: member.userId, role: 'member', displayName: 'Member' }]);
    await expect(postThreadMessage(stale, member, 'THR-99999999', msg('into the void'))).rejects.toThrow(/not found/i);
  });
});
