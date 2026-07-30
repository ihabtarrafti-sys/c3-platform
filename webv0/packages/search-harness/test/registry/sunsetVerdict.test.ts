/**
 * sunsetVerdict.test.ts — the sunset gate must SAY what failed.
 *
 * ⚖️ THE DEFECT THIS CLOSES. The CLI suppresses the message of any error that is
 * not a `HearthHarnessError` — deliberate containment, because raw runtime text
 * can carry planted sentinels or query text. The cost was that EVERY sunset
 * drift surfaced as `{"code":"HARNESS_COMMAND_FAILED","message":"…suppressed"}`,
 * so a genuine contract violation was indistinguishable from an infrastructure
 * fault. **A fault is the thing people retry rather than investigate** — and for
 * a seal whose entire purpose is to notice that a guard was DELETED, that was
 * the worst available signal, on a machine where we have spent a week teaching
 * ourselves that weird failures mean load.
 *
 * ⛔ THE BINDING CONDITION on unsuppressing it: the registry message stays
 * composed of CODES AND PATHS ONLY, forever. The moment it carries a VALUE — a
 * fingerprint, a diff fragment, a file excerpt — the containment breaks. Two
 * mechanisms enforce that, because a rule without a mechanism is a wish:
 *   1. `sunsetFailureSummary` takes `SunsetFailureLabel`, a type with no value
 *      fields, so interpolating one fails to COMPILE; and
 *   2. the sentinel test below, in case someone widens that type.
 */
import { describe, expect, it } from 'vitest';
import {
  SunsetRegistryError,
  compareSunsetRegistry,
  sunsetFailureSummary,
  type SunsetFailureLabel,
} from '../../src/registry/compare';
import {
  SunsetCoverageError,
  redactFactKey,
  type RedactedFactName,
} from '../../src/registry/coverage';
import {
  buildLiveSunsetRegistrySnapshot,
  fingerprintSunsetTypeScriptDeclarations,
} from '../../src/registry/liveSnapshot';
import { HearthHarnessError } from '../../src/errors';
import { safeHarnessCommandError } from '../../src/cli/common';
import type { SunsetRegistryFailure, SunsetRegistrySnapshot } from '../../src/registry/types';

/** A value that must never reach an operator's terminal. */
const SENTINEL = 'c3-sentinel-2f9a4d1e-must-not-leak';

const failureCarryingValues: SunsetRegistryFailure = {
  code: 'SUNSET_CRITICAL_SOURCE_CHANGED',
  path: 'criticalSourceFingerprints.apps/web/src/tablework/TruthPanel.tsx#truthStateOf',
  expected: SENTINEL,
  actual: `${SENTINEL}-actual`,
};

describe('GUARD 1 — the registry verdict NAMES itself instead of reading as a crash', () => {
  it('is a HearthHarnessError, so the CLI preserves its message rather than suppressing it', () => {
    const error = new SunsetRegistryError([failureCarryingValues]);
    expect(error).toBeInstanceOf(HearthHarnessError);
    expect(error.code).toBe('SUNSET_REGISTRY_DRIFTED');
    expect(error.name).toBe('SunsetRegistryError');
  });

  it('survives the CLI safety filter with its code AND its failure list intact', () => {
    // This is the end-to-end property: what an operator actually sees.
    const safe = safeHarnessCommandError(new SunsetRegistryError([failureCarryingValues]));
    expect(safe.code).toBe('SUNSET_REGISTRY_DRIFTED');
    expect(safe.message).toContain('SUNSET_CRITICAL_SOURCE_CHANGED');
    expect(safe.message).toContain('TruthPanel.tsx#truthStateOf');
    // ⛔ Before this change the same call produced HARNESS_COMMAND_FAILED with
    // the message replaced by "sensitive runtime error text was suppressed".
    expect(safe.code).not.toBe('HARNESS_COMMAND_FAILED');
  });
});

describe('GUARD 2 — CODES AND PATHS ONLY: no value may ride the message out', () => {
  it('the summary reports the code and path and leaks NEITHER expected NOR actual', () => {
    const summary = sunsetFailureSummary([failureCarryingValues]);
    expect(summary).toContain('SUNSET_CRITICAL_SOURCE_CHANGED');
    expect(summary).toContain('TruthPanel.tsx#truthStateOf');
    expect(summary).not.toContain(SENTINEL);
  });

  it('and the sentinel does not survive the whole error → CLI path either', () => {
    const safe = safeHarnessCommandError(new SunsetRegistryError([failureCarryingValues]));
    expect(safe.message).not.toContain(SENTINEL);
    expect(JSON.stringify(safe)).not.toContain(SENTINEL);
  });
});

describe('GUARD 3 — coverage travels by NAME, never by VALUE', () => {
  it('emits the fact NAME and redacts the value', () => {
    // Real factKeys: `criticalSourceFingerprintsSha256=ecae78ce…`,
    // `contractResultKinds[9]="team"`. The left side is a field name or a
    // positional index and carries no data; the right side is the value.
    const error = new SunsetCoverageError([
      {
        code: 'SUNSET_COVERAGE_FACT_MISSING',
        surface: 'visibility-matrix',
        factKey: `criticalSourceFingerprintsSha256=${SENTINEL}`,
      },
    ]);
    const safe = safeHarnessCommandError(error);
    expect(safe.code).toBe('SUNSET_COVERAGE_INCOMPLETE');
    expect(safe.message).toContain('criticalSourceFingerprintsSha256=<redacted>');
    expect(safe.message).toContain('visibility-matrix');
    // ⛔ The whole point: the operator learns WHICH contract drifted, never the value.
    expect(safe.message).not.toContain(SENTINEL);
    expect(JSON.stringify(safe)).not.toContain(SENTINEL);
  });

  it('splits on the FIRST "=", so a value containing one cannot smuggle itself out', () => {
    expect(redactFactKey(`name=a=${SENTINEL}`)).toBe('name=<redacted>');
    expect(redactFactKey(`name=a=${SENTINEL}`)).not.toContain(SENTINEL);
  });

  it('a factKey with NO "=" yields NOTHING — an unrecognised shape says only its code', () => {
    // The fallback that stops this from rotting: never emit an unsplit key on
    // the assumption the shape holds.
    expect(redactFactKey(SENTINEL)).toBe('');
    const error = new SunsetCoverageError([
      { code: 'SUNSET_COVERAGE_FACT_UNKNOWN', surface: 'qrels', factKey: SENTINEL },
    ]);
    expect(safeHarnessCommandError(error).message).not.toContain(SENTINEL);
  });

  it('and an absent factKey degrades cleanly rather than printing "undefined"', () => {
    const error = new SunsetCoverageError([
      { code: 'SUNSET_COVERAGE_ENTRY_ORDER_CHANGED', surface: 'provenance' },
    ]);
    const message = safeHarnessCommandError(error).message;
    expect(message).toContain('SUNSET_COVERAGE_ENTRY_ORDER_CHANGED provenance');
    expect(message).not.toContain('undefined');
  });
});

describe('GUARD 3b — the containment is held by the COMPILER, not by discipline', () => {
  it('a raw factKey cannot be passed where a redacted name is required', () => {
    // @ts-expect-error — only redactFactKey can mint a RedactedFactName. If this
    // ever STOPS erroring, the brand has been weakened and tsc fails on the now
    // unused @ts-expect-error. That is the mechanism guarding the mechanism.
    const smuggled: RedactedFactName = `criticalSourceFingerprintsSha256=${SENTINEL}`;
    expect(typeof smuggled).toBe('string');
  });

  it('a registry failure LABEL has no value fields to interpolate in the first place', () => {
    const label: SunsetFailureLabel = {
      code: 'SUNSET_CRITICAL_SOURCE_CHANGED',
      path: 'criticalSourceFingerprints.x',
    };
    // @ts-expect-error — `expected` is deliberately absent from SunsetFailureLabel,
    // so `sunsetFailureSummary` physically cannot reach a value.
    expect(label.expected).toBeUndefined();
  });
});

describe('GUARD 4 — DELETION is a typed verdict, not an ENOENT crash', () => {
  const SEAL = 'apps/web/test/identityTokens.test.ts#wiring';

  it('a fingerprint key that vanished reports SUNSET_CRITICAL_SOURCE_REMOVED, naming the file', () => {
    // Modelled against the REAL snapshot rather than a hand-rolled fixture, so
    // this cannot pass by inventing a shape the comparison does not actually use.
    // Deleting the file makes the live snapshot OMIT this key
    // (readRepoFileIfPresent returns null); everything else is identical.
    const frozen = buildLiveSunsetRegistrySnapshot();
    expect(frozen.criticalSourceFingerprints[SEAL], 'the seal must exist to be deletable').toBeTruthy();

    const surviving = Object.fromEntries(
      Object.entries(frozen.criticalSourceFingerprints).filter(([key]) => key !== SEAL),
    );
    const live: SunsetRegistrySnapshot = { ...frozen, criticalSourceFingerprints: surviving };

    const failures = compareSunsetRegistry(frozen, live);
    const removed = failures.filter((f) => f.code === 'SUNSET_CRITICAL_SOURCE_REMOVED');
    expect(removed).toHaveLength(1);
    expect(removed[0]?.path).toContain('identityTokens.test.ts#wiring');

    // …and it reaches the operator as a named verdict, in the normal voice.
    const safe = safeHarnessCommandError(new SunsetRegistryError(failures));
    expect(safe.code).toBe('SUNSET_REGISTRY_DRIFTED');
    expect(safe.message).toContain('SUNSET_CRITICAL_SOURCE_REMOVED');
    expect(safe.message).toContain('identityTokens.test.ts');
  });
});

describe('GUARD 5 — a deleted SYMBOL behaves like a deleted file, and only when asked', () => {
  const source = 'export function keptOne() { return 1; }\n';

  it('omits a missing declaration under onMissing: "omit"', () => {
    const result = fingerprintSunsetTypeScriptDeclarations(
      'apps/web/src/tablework/TruthPanel.tsx',
      source,
      ['keptOne', 'truthStateOf'],
      'omit',
    );
    expect(Object.keys(result)).toEqual(['keptOne']); // the deleted symbol simply drops out
  });

  it('still THROWS by default, so existing callers and their tests are untouched', () => {
    expect(() =>
      fingerprintSunsetTypeScriptDeclarations('x.ts', source, ['keptOne', 'truthStateOf']),
    ).toThrow(/critical declaration truthStateOf was not found/);
  });
});
