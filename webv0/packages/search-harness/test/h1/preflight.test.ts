import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  R6_AUTHORITY_MODEL,
  R6_EXTERNAL_MANIFEST_ROOT,
  loadR6VerifiedAuthority,
  runR6AuthorityPreflight,
  type LoadedR6VerifiedAuthority,
  type SideEffectLedger,
} from '../../src/h1/preflight.js';

const authorityDirectory = fileURLToPath(
  new URL('../../authority/r6/', import.meta.url),
);

function cleanLedger(): SideEffectLedger {
  return { attemptedEvents: [] };
}

describe('HEARTH-003-r6 H1 authority preflight', () => {
  it('verifies the closed bundle and semantic drift-detector boundary before a side effect', () => {
    const afterVerified = vi.fn();
    const ledger = cleanLedger();

    const report = runR6AuthorityPreflight({
      authorityDirectory,
      afterVerified,
      afterVerifiedCapability: 'seed',
      sideEffectLedger: ledger,
    });

    expect(report).toMatchObject({
      authorityModel: R6_AUTHORITY_MODEL,
      externallyPinnedManifestRoot: R6_EXTERNAL_MANIFEST_ROOT,
      verifiedSlotCount: 37,
      crossBindingCount: 59,
      slotContentBindingCount: 4,
      qrelCaseCount: 280,
      qrelJudgmentCount: 315,
      residualGroupCount: 6,
      residualItemCount: 26,
      baselineRegisterCount: 17,
      baselineMatchFieldCount: 64,
      baselineProjectionExpressionCount: 68,
      baselineProjectionFieldReferenceCount: 83,
      baselineObservationCount: 49_840,
      driftRedControlCount: 2,
      acceptanceTargetCount: 10,
      measurementStatus: 'NOT_YET_MEASURED',
    });
    expect(report.doesNotProve).toContain(
      'that B0 is authorized, correct, complete, or leak-free',
    );
    expect(afterVerified).toHaveBeenCalledOnce();
    expect(ledger.attemptedEvents).toEqual([
      { sequence: 1, capability: 'seed' },
    ]);
  });

  it('blocks a content mutation before the injected side effect', () => {
    const afterVerified = vi.fn();
    const ledger = cleanLedger();
    const qrelsPath = join(
      authorityDirectory,
      'HEARTH-003-QRELS-v7.json',
    );

    expect(() =>
      runR6AuthorityPreflight({
        authorityDirectory,
        sideEffectLedger: ledger,
        afterVerified,
        afterVerifiedCapability: 'seed',
        readFile: (path) => {
          const bytes = readFileSync(path);
          if (path !== qrelsPath) return bytes;
          const text = bytes.toString('utf8');
          return Buffer.from(
            text.replace(
              '"baselineActorClasses"',
              '"approvedActorClasses"',
            ),
            'utf8',
          );
        },
      }),
    ).toThrow(/AUTHORITY_BUNDLE_CONTENT_HASH_MISMATCH/u);
    expect(afterVerified).not.toHaveBeenCalled();
    expect(ledger.attemptedEvents).toEqual([]);
  });

  it('serves copied, immutable authority values without a post-verification filesystem read', () => {
    const qrelsSlot = 'HEARTH-003-QRELS-v7.json';
    const qrelsPath = join(authorityDirectory, qrelsSlot);
    const mutableDirectory = mkdtempSync(
      join(tmpdir(), 'c3-hearth-r6-view-'),
    );
    const mutableQrelsPath = join(mutableDirectory, qrelsSlot);
    copyFileSync(qrelsPath, mutableQrelsPath);
    try {
      let readCount = 0;
      const loaded = loadR6VerifiedAuthority({
        authorityDirectory,
        readFile: (path) => {
          readCount += 1;
          return readFileSync(
            path === qrelsPath ? mutableQrelsPath : path,
          );
        },
      });
      const verifiedReadCount = readCount;

      writeFileSync(
        mutableQrelsPath,
        '{"querySetVersion":"MUTATED_AFTER_VERIFY"}\n',
        'utf8',
      );
      const first = loaded.authority.readJson(qrelsSlot);
      expect(readCount).toBe(verifiedReadCount);
      expect(first.querySetVersion).toBe('HEARTH-003-QRELS-v7');
      expect(Object.isFrozen(first)).toBe(true);
      expect(Object.isFrozen(first.cases)).toBe(true);
      expect(() => {
        (first as Record<string, unknown>).querySetVersion =
          'CALLER_MUTATION';
      }).toThrow(TypeError);

      const second = loaded.authority.readJson(qrelsSlot);
      expect(second).not.toBe(first);
      expect(second.querySetVersion).toBe('HEARTH-003-QRELS-v7');
      expect(readCount).toBe(verifiedReadCount);

      expect(
        loaded.authority.readText(
          'HEARTH-003-r6-MATERIALIZATION-CONTRACT.md',
        ),
      ).toContain('execute the B0/O0 drift RED');
      expect(() =>
        loaded.authority.readJson(
          'HEARTH-003-r6-MATERIALIZATION-CONTRACT.md',
        ),
      ).toThrow(/R6_AUTHORITY_SLOT_NOT_JSON/u);
      expect(() =>
        loaded.authority.readText(qrelsSlot),
      ).toThrow(/R6_AUTHORITY_SLOT_NOT_TEXT/u);
      expect(() =>
        loaded.authority.readJson('HEARTH-003-NOT-A-SLOT.json'),
      ).toThrow(/R6_AUTHORITY_SLOT_UNKNOWN/u);
    } finally {
      rmSync(mutableDirectory, { recursive: true, force: true });
    }
  });

  it('fails when a RED mutation is bypassed instead of observing its typed failure', () => {
    const afterVerified = vi.fn();
    const ledger = cleanLedger();
    let loaded: LoadedR6VerifiedAuthority | undefined;

    expect(() => {
      loaded = loadR6VerifiedAuthority({
        authorityDirectory,
        redDiscriminationFaultForTest: 'skip-first-mutation',
      });
    }).toThrow(/R6_DRIFT_RED_NOT_DISCRIMINATING/u);
    expect(loaded).toBeUndefined();

    expect(() =>
      runR6AuthorityPreflight({
        authorityDirectory,
        sideEffectLedger: ledger,
        afterVerified,
        afterVerifiedCapability: 'seed',
        redDiscriminationFaultForTest: 'skip-first-mutation',
      }),
    ).toThrow(/R6_DRIFT_RED_NOT_DISCRIMINATING/u);
    expect(afterVerified).not.toHaveBeenCalled();
    expect(ledger.attemptedEvents).toEqual([]);
  });

  it('fails closed when the directory omits a declared slot', () => {
    const afterVerified = vi.fn();
    const ledger = cleanLedger();
    const actual = readdirSync(authorityDirectory);

    expect(() =>
      runR6AuthorityPreflight({
        authorityDirectory,
        sideEffectLedger: ledger,
        afterVerified,
        afterVerifiedCapability: 'seed',
        listDirectory: () =>
          actual.filter(
            (name) => name !== 'HEARTH-003-QRELS-v7.json',
          ),
      }),
    ).toThrow(/AUTHORITY_BUNDLE_REQUIRED_ARTIFACT_MISSING/u);
    expect(afterVerified).not.toHaveBeenCalled();
    expect(ledger.attemptedEvents).toEqual([]);
  });

  it('fails closed when the directory contains an undeclared slot', () => {
    const afterVerified = vi.fn();
    const ledger = cleanLedger();
    const actual = readdirSync(authorityDirectory);

    expect(() =>
      runR6AuthorityPreflight({
        authorityDirectory,
        sideEffectLedger: ledger,
        afterVerified,
        afterVerifiedCapability: 'seed',
        listDirectory: () => [...actual, 'unapproved-authority.json'],
      }),
    ).toThrow(/AUTHORITY_BUNDLE_UNEXPECTED_ARTIFACT/u);
    expect(afterVerified).not.toHaveBeenCalled();
    expect(ledger.attemptedEvents).toEqual([]);
  });
});
