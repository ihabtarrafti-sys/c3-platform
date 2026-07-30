/**
 * commsLatencyDisarm.test.ts — C4: the latency shape is GONE, not merely unused.
 *
 * Guardrail Zero's latency law says no per-person response pattern may EVER be
 * derivable. A rule that only forbids WRITING the data is weaker than one that
 * removes an OPERAND: the first can be broken by a future writer, the second
 * cannot be broken at all.
 *
 * ⚠️ The finding that produced migration 0101: `comms_attention` carried both
 * operands AND `comms_attention_inbox` INDEXED them together — the forbidden
 * join was optimised, not merely possible. **An index is the schema stating
 * what it expects to be asked.** So this file checks the index too, which is
 * the sweep law that came out of missing it the first time.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

describe('C4 — the de-arming (0101), proven against the live schema', () => {
  it('the TIMESTAMP is gone: comms_attention has no read_at, so the interval has no operand', async () => {
    const cols = await db.adminQuery<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'comms_attention'`,
    );
    const names = cols.map((c) => c.column_name);
    expect(names).not.toContain('read_at');
    // …while the read FACT survives: the badge knows IF, never WHEN.
    expect(names).toContain('read');
    // …and emitted_at stays — a fact about the SYSTEM's act, not the person's.
    expect(names).toContain('emitted_at');
  });

  it('THE INDEX IS GONE TOO — the confession is retracted, not just the column', async () => {
    const idx = await db.adminQuery<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'comms_attention'`,
    );
    const defs = idx.map((i) => i.indexdef).join('\n');
    // No index may mention read_at at all…
    expect(defs).not.toMatch(/read_at/);
    // …and the replacement serves the bell's own question instead.
    expect(defs).toMatch(/comms_attention_inbox/);
    expect(defs).toMatch(/\bread\b/);
  });

  it('the interval is UNCOMPUTABLE: the forbidden query cannot even parse against this schema', async () => {
    // The strongest available proof — not "we do not run this query" but "this
    // query cannot run". A future writer cannot re-introduce the derivation
    // without first re-introducing the column, which is a migration and a
    // decision rather than a drift.
    await expect(
      db.adminQuery(`SELECT recipient_user_id, avg(read_at - emitted_at) FROM comms_attention GROUP BY 1`),
    ).rejects.toThrow(/read_at/);
  });

  it('the outbox’s per-recipient timing stays DORMANT — no application code writes it', async () => {
    // 0093's outbox carries scheduling times by design (available_at,
    // leased_until). They are the DRAIN's own mechanics, not a record of when a
    // person read anything — and nothing writes them today. Stated rather than
    // silently assumed, so the next phase inherits the boundary.
    const rows = await db.adminQuery<{ n: string }>(`SELECT count(*)::text AS n FROM comms_delivery_outbox`);
    expect(Number(rows[0]?.n)).toBe(0);
  });
});
