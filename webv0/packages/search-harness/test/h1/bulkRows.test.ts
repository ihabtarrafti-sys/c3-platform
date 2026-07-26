import { readFile } from 'node:fs/promises';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  H1BulkRowError,
  materializeH1BulkRows,
  type H1BulkSeedMaterialization,
} from '../../src/h1/bulkRows.js';
import { planH1Corpus, type H1CorpusPlan } from '../../src/h1/corpusPlanner.js';

describe('H1 deterministic physical bulk rows', () => {
  let corpus: H1CorpusPlan;
  let materialization: H1BulkSeedMaterialization;

  beforeAll(async () => {
    const fixture = JSON.parse(
      await readFile(
        new URL(
          '../../authority/r6/HEARTH-003-FIXTURE-CONTRACT-v5.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as unknown;
    corpus = planH1Corpus(fixture);
    materialization = materializeH1BulkRows(corpus);
  }, 60_000);

  it('materializes all 99,403 filler records in dependency-ordered phases', () => {
    expect(materialization).toMatchObject({
      measurementStatus: 'NOT_YET_MEASURED',
      rowCount: 99_403,
    });
    expect(materialization.rows[0]).toMatchObject({
      phase: 100,
      table: 'entity',
      tenantSlot: 'T01',
    });
    expect(Math.min(...materialization.rows.map(({ phase }) => phase))).toBe(100);
    expect(Math.max(...materialization.rows.map(({ phase }) => phase))).toBe(150);
    expect(
      materialization.rows.every(
        ({ phase }, index, rows) =>
          index === 0 || (rows[index - 1]?.phase ?? phase) <= phase,
      ),
    ).toBe(true);
    expect(materialization.rowsCanonicalSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('uses deterministic, schema-shaped dependencies without qrel input', () => {
    const journey = materialization.rows.find(
      ({ table }) => table === 'journey',
    );
    const invoice = materialization.rows.find(
      ({ table }) => table === 'invoice',
    );
    const distribution = materialization.rows.find(
      ({ table }) => table === 'distribution',
    );
    const document = materialization.rows.find(
      ({ table }) => table === 'document',
    );

    expect(journey?.values).toMatchObject({
      status: 'Active',
      created_by_approval_id: expect.stringMatching(/^hearthbulk-/u),
    });
    expect(invoice?.values).toMatchObject({
      status: 'Voided',
      line_id: expect.stringMatching(/^hearthbulk-/u),
    });
    expect(distribution?.values).toMatchObject({
      status: 'Live',
      org_share_bps: 10_000,
      org_cut_minor: 100,
      pool_minor: 100,
    });
    expect(document?.values).toMatchObject({
      record_kind: 'RegisteredEvidence',
      is_active: true,
      owner_type: 'Mission',
    });
  });

  it('deterministically rejection-samples cryptographic fields that collide with reserved tokens', () => {
    const row = materialization.rows.find(
      ({ rowId }) => rowId === 'H1B.T02.document.bbhtd',
    );
    expect(row?.values['sha256']).toBe(
      '1fcace45dc2b2be68980590b02402b48429b120883d934967246e6094725a19c',
    );
    expect(String(row?.values['sha256'])).not.toContain('21400');
  });

  it('does not inherit a runtime clock for any generated row', () => {
    for (const row of materialization.rows) {
      expect(row.values).toMatchObject({
        created_at: '2035-06-15T12:00:00.000Z',
        updated_at: '2035-06-15T12:00:00.000Z',
      });
    }
    expect(
      materialization.rows.find(({ table }) => table === 'approval')
        ?.values,
    ).toMatchObject({
      submitted_at: '2035-06-15T12:00:00.000Z',
    });
  });

  it('RED: fails when a newly reserved token appears only in a non-search field', () => {
    const mutated = {
      ...corpus,
      reservedQueryTokens: [
        ...corpus.reservedQueryTokens,
        'synthetic.invalid',
      ],
    } as H1CorpusPlan;
    expect(() => materializeH1BulkRows(mutated)).toThrow(H1BulkRowError);
  });
});
