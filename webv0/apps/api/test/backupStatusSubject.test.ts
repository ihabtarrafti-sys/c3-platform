/**
 * backupStatusSubject.test.ts — CR-031 on the SECOND independent reader.
 *
 * ⛔ WHY A SEPARATE TEST FOR WHAT LOOKS LIKE THE SAME FIX. The backup-status tile
 * MIRRORS `apps/backup/src/freshness.ts` rather than importing it (apps are not
 * cross-importable here). A mirror is a promise that two implementations change
 * together — and CR-012 already collected on that promise: a future-dated-marker
 * fix landed on the monitor and left this tile reporting healthy.
 *
 * ⚠️ Before this file, `createBackupStatusReader` had NO test of its own. The
 * untested half of a mirrored pair is the half that drifts.
 */
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { createBackupStatusReader, refuseUnlessMarkerSubjectMatches } from '../src/backupStatus';

const EXPECTED = { environment: 'production', mode: 'daily' };

describe('⛔ the tile refuses a marker describing something else', () => {
  it('accepts the marker it is responsible for', () => {
    expect(refuseUnlessMarkerSubjectMatches({ environment: 'production', mode: 'daily' }, EXPECTED)).toBeNull();
  });

  it('⛔ refuses a genuine marker for a DIFFERENT environment', () => {
    // The staging backup can be perfectly healthy and perfectly fresh. It is not
    // evidence that the production backup ran.
    const reason = refuseUnlessMarkerSubjectMatches({ environment: 'staging', mode: 'daily' }, EXPECTED);
    expect(reason).toMatch(/environment=staging/);
    expect(reason).toMatch(/production/);
  });

  it('⛔ refuses a different MODE — a weekly copy is not the daily backup', () => {
    const reason = refuseUnlessMarkerSubjectMatches({ environment: 'production', mode: 'weekly' }, EXPECTED);
    expect(reason).toMatch(/mode=weekly/);
  });

  it('⛔ refuses an ABSENT discriminator, and says so differently than a mismatch', () => {
    // "I cannot tell what this describes" and "this describes something else" are
    // different problems with different fixes; one message for both would hide which.
    const absent = refuseUnlessMarkerSubjectMatches({ mode: 'daily' }, EXPECTED);
    const mismatch = refuseUnlessMarkerSubjectMatches({ environment: 'staging', mode: 'daily' }, EXPECTED);
    expect(absent).toMatch(/does not name its environment/);
    expect(absent).not.toBe(mismatch);
  });

  it('refuses a non-string discriminator rather than coercing it', () => {
    expect(refuseUnlessMarkerSubjectMatches({ environment: 42, mode: 'daily' }, EXPECTED)).toMatch(/does not name/);
    expect(refuseUnlessMarkerSubjectMatches({ environment: '', mode: 'daily' }, EXPECTED)).toMatch(/does not name/);
  });
});

describe('⛔ an UNBOUND tile cannot report healthy (fail closed, without an outage)', () => {
  /** Only `backupStatus` is read by the reader; the rest of Env is irrelevant here. */
  const envWith = (expectedEnvironment: string | null, expectedMode: string | null): Env =>
    ({
      backupStatus: {
        endpoint: 'https://example.invalid',
        accessKeyId: 'k',
        secretAccessKey: 's',
        bucket: 'b',
        expectedEnvironment,
        expectedMode,
      },
    }) as unknown as Env;

  it('⛔ reports UNHEALTHY when the subject is unset — and never touches the network', async () => {
    // The endpoint above is deliberately unresolvable. If this test passes, the
    // refusal happened BEFORE the fetch — which is the ordering the fix relies on:
    // there is nothing worth computing when the answer cannot be interpreted.
    const view = await createBackupStatusReader(envWith(null, null))();
    expect(view.configured).toBe(true);
    expect(view.healthy).toBe(false);
    expect(view.reason).toMatch(/BACKUP_STATUS_EXPECTED_ENVIRONMENT/);
    expect(view.reason).toMatch(/has not found that backup healthy/);
    // No age is offered. A number that exists is a number someone eventually surfaces.
    expect(view.ageHours).toBeNull();
    expect(view.lastSuccessUtc).toBeNull();
  });

  it('⛔ a HALF-bound tile is unbound — one of the two is not enough', async () => {
    const view = await createBackupStatusReader(envWith('production', null))();
    expect(view.healthy).toBe(false);
    expect(view.reason).toMatch(/BACKUP_STATUS_EXPECTED_MODE/);
  });

  it('⛳ healthy stays REACHABLE — the refusal is not a constant', async () => {
    // The positive control. Without it, a reader hard-wired to say "unhealthy"
    // would pass every assertion above (LAW 29: right by coincidence). A bound
    // tile gets past the subject gate and fails on the unreachable endpoint
    // instead — a DIFFERENT reason, which is the whole point.
    const view = await createBackupStatusReader(envWith('production', 'daily'))();
    expect(view.reason).not.toMatch(/BACKUP_STATUS_EXPECTED/);
    expect(view.reason).toMatch(/No latest-success marker readable/);
  });
});
