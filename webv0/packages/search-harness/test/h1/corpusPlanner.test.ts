import { readFile } from 'node:fs/promises';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  H1CorpusPlanError,
  H1_REGISTER_TARGETS,
  findReservedQueryToken,
  planH1Corpus,
  type H1CorpusPlan,
} from '../../src/h1/corpusPlanner.js';
import { canonicalSha256 } from '../../src/canonical.js';

async function readFixture(): Promise<Record<string, any>> {
  const bytes = await readFile(
    new URL(
      '../../authority/r6/HEARTH-003-FIXTURE-CONTRACT-v5.json',
      import.meta.url,
    ),
    'utf8',
  );
  return JSON.parse(bytes) as Record<string, any>;
}

describe('H1 deterministic corpus planning', () => {
  let fixture: Record<string, any>;
  let plan: H1CorpusPlan;

  beforeAll(async () => {
    fixture = await readFixture();
    plan = planH1Corpus(fixture);
  }, 60_000);

  it('cross-foots exactly 50,000 intended-searchable rows per tenant', () => {
    expect(plan.measurementStatus).toBe('NOT_YET_MEASURED');
    expect(plan.authoritySources).toHaveLength(597);
    expect(plan.bulkRecords).toHaveLength(99_403);
    expect(plan.authorityFixtureCanaryCount).toBe(37);
    expect(plan.distribution).toHaveLength(34);

    for (const entry of plan.distribution) {
      expect(entry.targetCount).toBe(H1_REGISTER_TARGETS[entry.register]);
      expect(
        entry.authorityIntendedSearchableCount + entry.generatedBulkCount,
      ).toBe(entry.targetCount);
    }
    for (const tenantSlot of ['T01', 'T02'] as const) {
      expect(
        plan.distribution
          .filter((entry) => entry.tenantSlot === tenantSlot)
          .reduce((sum, entry) => sum + entry.targetCount, 0),
      ).toBe(50_000);
    }
  });

  it('exposes deterministic DB-adapter metadata without qrel input', () => {
    const first = plan.bulkRecords[0];
    const last = plan.bulkRecords.at(-1);

    expect(first).toMatchObject({
      bulkRowId: 'H1B.T01.person.bbbbb',
      tenantSlot: 'T01',
      register: 'person',
      physicalTable: 'person',
      countedOrdinal: 72,
      generatedOrdinal: 1,
      source: {
        tenantSlot: 'T01',
        register: 'person',
        recordId: 'hearthbulk-t01-per-bbbbb',
        recordKind: null,
      },
    });
    expect(last).toMatchObject({
      tenantSlot: 'T02',
      register: 'beneficiary',
      physicalTable: 'beneficiary',
      source: { recordKind: null },
    });
    expect(plan.manifestInputs.baselineUse).toBe(
      'drift-detector-against-dae27a4',
    );
    expect(plan.manifestInputs.measurementStatus).toBe('NOT_YET_MEASURED');
    expect(canonicalSha256(plan.manifestInputs)).toBe(plan.manifestSha256);
  });

  it('keeps every generated search-visible value outside reserved tokens', () => {
    for (const row of [
      plan.bulkRecords[0],
      plan.bulkRecords[49_701],
      plan.bulkRecords.at(-1),
    ]) {
      expect(row).toBeDefined();
      for (const value of [
        row!.source.recordId,
        row!.deterministicFields.primaryText,
        row!.deterministicFields.secondaryText,
        row!.deterministicFields.code,
      ]) {
        expect(findReservedQueryToken(value, plan.reservedQueryTokens)).toBeNull();
      }
    }
  });

  it('RED: fails closed when authority reserves the bulk namespace', () => {
    const tokens = fixture['reservedQueryTokens'] as string[];
    const prior = tokens[0];
    tokens[0] = 'hearthbulk';
    try {
      expect(() => planH1Corpus(fixture)).toThrow(H1CorpusPlanError);
    } finally {
      tokens[0] = prior!;
    }
  });
});
