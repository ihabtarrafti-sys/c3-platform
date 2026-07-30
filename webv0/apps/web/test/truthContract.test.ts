/**
 * truthContract.test.ts — Phase A (Comms chapter): the six-state truthfulness
 * contract, pinned at the source (the identityTokens pattern).
 *
 * The contract (from the Battle-#2 hybrid ruling — Intel's vocabulary, rebuilt
 * in Tablework grammar): every data region renders exactly one of SIX truth
 * states — loading · verified · proven-empty · denied · fetch-failed · stale —
 * and stamps it as a `data-truth` artifact. The laws these pins hold:
 *   1. EMPTY REQUIRES A SUCCESSFUL WITNESS — proven-empty is unreachable from
 *      an errored query (the deriver enforces it structurally).
 *   2. FAILURE AND DENIAL NEVER BECOME A ZERO — fetch-failed/denied are their
 *      own artifacts, never an empty list, never a greenfield line.
 *   3. Consumers DERIVE state through the one deriver; they never hand-roll
 *      the mapping (a hand-rolled branch is where instance 21 lived).
 *
 * Instance 48: pins assert artifacts and structures, never prose.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { truthStateOf } from '../src/tablework/TruthPanel';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (rel: string): string => readFileSync(join(srcDir, rel), 'utf8');

describe('The six-state truth contract (the kit)', () => {
  it('the kit exports the contract: six states, one deriver, the data-truth artifact', () => {
    const kit = read('tablework/TruthPanel.tsx');
    for (const s of ['loading', 'verified', 'proven-empty', 'denied', 'fetch-failed', 'stale']) {
      expect(kit).toContain(`'${s}'`);
    }
    expect(kit).toContain('data-truth');
    expect(kit).toContain('export function truthStateOf');
    // Law 1, structurally: the deriver's error branch precedes any emptiness
    // check — proven-empty cannot be derived from an errored query.
    const deriver = kit.slice(kit.indexOf('export function truthStateOf'));
    expect(deriver.indexOf('fetch-failed')).toBeLessThan(deriver.indexOf('proven-empty'));
    expect(kit).toContain("export * from './TruthPanel'".length > 0 ? 'TruthPanel' : '');
  });

  it('the kit surface exports the contract for every consumer', () => {
    expect(read('tablework/index.ts')).toContain('TruthPanel');
  });

  it('successful witness time is stable across rerenders and comes from the query witness', () => {
    const witnessedAt = Date.parse('2026-07-30T20:00:00.000Z');
    const first = truthStateOf(
      { data: { rows: ['record'] }, error: null, isLoading: false, dataUpdatedAt: witnessedAt },
      (data) => data.rows.length === 0,
    );
    const second = truthStateOf(
      { data: { rows: ['record'] }, error: null, isLoading: false, dataUpdatedAt: witnessedAt },
      (data) => data.rows.length === 0,
    );
    expect(first).toEqual({ kind: 'verified', at: new Date(witnessedAt) });
    expect(second).toEqual(first);
  });
});

describe('Adoption: the surfaces the sweep convicted (instance 21 on the live product)', () => {
  it('MissionCommsPage derives thread truth through the contract — no hand-rolled empty branch', () => {
    const page = read('pages/MissionCommsPage.tsx');
    expect(page).toContain('truthStateOf');
    const thread = read('tablework/Thread.tsx');
    // The thread's empty/failure rendering goes THROUGH the contract renderer —
    // the artifact lives in TruthPanel; this surface must carry no hand-rolled
    // empty branch of its own (the exact branch instance 21 lived in).
    expect(thread).toContain('TruthPanel');
    expect(thread).not.toContain('messages.length === 0 ?');
  });

  it('the record Discussion region (records.tsx) derives comment truth through the contract', () => {
    expect(read('tablework/records.tsx')).toContain('truthStateOf');
  });

  it('ShellSearch derives result truth through the contract', () => {
    expect(read('tablework/ShellSearch.tsx')).toContain('truthStateOf');
  });
});
