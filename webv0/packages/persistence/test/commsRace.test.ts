/**
 * commsRace.test.ts — the slice's two concurrent-write seams under a REAL
 * two-connection race (the db.test.ts R3-N03 convention):
 *  1. seq allocation: the thread-row lock serialises concurrent senders — the
 *     second bump BLOCKS until the first commits, then takes the next value
 *     (never a lost update, never MAX+1).
 *  2. send idempotency: two same-clientMutationId inserts — the loser's
 *     ON CONFLICT DO NOTHING lands zero rows; exactly ONE message exists.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';

let db: TestDatabase;
let tenantId: string;

beforeAll(async () => {
  db = await startTestDatabase();
  const seeded = await db.seedTenant({ slug: 'comms-race' });
  tenantId = seeded.tenantId;
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

const USER = '77777777-7777-7777-7777-777777777701';

async function seedThread(threadId: string, anchorId: string): Promise<void> {
  // Distinct anchor per thread — the one-per-anchor partial unique would
  // otherwise swallow the second seed (DO NOTHING) and fail the message FK.
  await db.adminQuery(
    `INSERT INTO comms_thread (tenant_id, thread_id, kind, anchor_type, anchor_id, created_by_user_id)
     VALUES ($1, $2, 'anchored', 'Mission', $3, $4)
     ON CONFLICT DO NOTHING`,
    [tenantId, threadId, anchorId, USER],
  );
}

describe('comms concurrent-write seams (two-connection)', () => {
  it('seq bump: the second sender blocks on the row lock, then takes the NEXT value', async () => {
    await seedThread('THR-9001', 'MSN-9001');
    const a = new Client({ connectionString: db.adminUrl });
    const b = new Client({ connectionString: db.adminUrl });
    await a.connect();
    await b.connect();
    try {
      await a.query('BEGIN');
      const aBump = await a.query(
        `UPDATE comms_thread SET last_seq = last_seq + 1, last_message_at = now() WHERE tenant_id=$1 AND thread_id='THR-9001' RETURNING last_seq`,
        [tenantId],
      );
      expect(Number(aBump.rows[0].last_seq)).toBe(1);

      await b.query('BEGIN');
      const bBumpPromise = b.query(
        `UPDATE comms_thread SET last_seq = last_seq + 1, last_message_at = now() WHERE tenant_id=$1 AND thread_id='THR-9001' RETURNING last_seq`,
        [tenantId],
      ); // BLOCKS on A's row lock
      await new Promise((r) => setTimeout(r, 150));
      await a.query('COMMIT');
      const bBump = await bBumpPromise;
      expect(Number(bBump.rows[0].last_seq)).toBe(2); // serialised, never a lost update
      await b.query('COMMIT');
    } finally {
      await a.end();
      await b.end();
    }
  });

  it('send idempotency: the concurrent duplicate lands ZERO rows — exactly one message', async () => {
    await seedThread('THR-9002', 'MSN-9002');
    const a = new Client({ connectionString: db.adminUrl });
    const b = new Client({ connectionString: db.adminUrl });
    await a.connect();
    await b.connect();
    const MUTATION = '99999999-9999-9999-9999-999999999901';
    const insert = (c: Client, messageId: string, seq: number) =>
      c.query(
        `INSERT INTO comms_message (tenant_id, message_id, thread_id, seq, author_user_id, client_mutation_id)
         VALUES ($1, $2, 'THR-9002', $3, $4, $5)
         ON CONFLICT (tenant_id, author_user_id, client_mutation_id) DO NOTHING
         RETURNING message_id`,
        [tenantId, messageId, seq, USER, MUTATION],
      );
    try {
      await a.query('BEGIN');
      const aIns = await a.query(
        `INSERT INTO comms_message (tenant_id, message_id, thread_id, seq, author_user_id, client_mutation_id)
         VALUES ($1, 'MSG-9001', 'THR-9002', 1, $2, $3)
         ON CONFLICT (tenant_id, author_user_id, client_mutation_id) DO NOTHING
         RETURNING message_id`,
        [tenantId, USER, MUTATION],
      );
      expect(aIns.rows).toHaveLength(1);

      await b.query('BEGIN');
      const bInsPromise = insert(b, 'MSG-9002', 2); // blocks on A's speculative insert
      await new Promise((r) => setTimeout(r, 150));
      await a.query('COMMIT');
      const bIns = await bInsPromise;
      expect(bIns.rows).toHaveLength(0); // the loser lands nothing
      await b.query('COMMIT');

      const rows = await db.adminQuery<{ n: string }>(
        `SELECT count(*) AS n FROM comms_message WHERE tenant_id = $1 AND client_mutation_id = $2`,
        [tenantId, MUTATION],
      );
      expect(Number(rows[0]!.n)).toBe(1);
    } finally {
      await a.end();
      await b.end();
    }
  });
});
