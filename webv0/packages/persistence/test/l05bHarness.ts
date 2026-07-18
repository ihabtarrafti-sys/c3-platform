/**
 * l05bHarness.ts — the L-05b output-equivalence harness (the deferral
 * contract from C3-L05-ASSESSMENT.md, Q6-amended with the role-visibility
 * assertion).
 *
 * Situation Room / Calendar / Departures are pure domain ENGINES
 * (composeSituation / buildCalendar / computeDepartureReadiness). Narrowing
 * their SQL inputs risks a silent computed-output change — a FIX-FIRST-class
 * failure. The law: NO SQL scoping ships for an engine surface until this
 * harness proves the scoped path's output is BYTE-IDENTICAL to the full-load
 * path's, per operational role, on a fixture that gives every register
 * material.
 *
 * A surface registers its canonical (full-load) `run`. When its scoped loader
 * lands, it plugs `runScoped` — the same assertion then gates the change.
 */
import type { Actor } from '@c3web/domain';

export interface EngineSurface<TView = unknown> {
  readonly name: string;
  /** The canonical full-load path (today's behavior — the truth). */
  run(actor: Actor): Promise<TView>;
  /** The SQL-scoped path — plugged in by the change that introduces scoping. */
  runScoped?: (actor: Actor) => Promise<TView>;
}

/**
 * Canonical byte form: JSON with every object's keys sorted, recursively.
 * Two views are equivalent IFF their canonical bytes are identical — field
 * order never masks or manufactures a difference.
 */
export function canonicalize(view: unknown): string {
  return JSON.stringify(sortKeys(view));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    // Adversarial-review fix: a Date/Map/Set/class instance has no enumerable
    // keys, so it would canonicalize to {} and let two DIFFERENT values
    // compare equal — a silent false negative in the very instrument that
    // gates FIX-FIRST-class failures. Refuse instead of silently passing.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      const name = (value as object).constructor?.name ?? 'unknown';
      throw new Error(`canonicalize: non-canonical value (${name}) — engine views must be plain JSON data`);
    }
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = sortKeys(src[key]);
    return out;
  }
  return value;
}

export class EquivalenceViolation extends Error {
  constructor(surface: string, kind: string, detail: string) {
    super(`L-05b equivalence violation [${surface}] ${kind}: ${detail}`);
    this.name = 'EquivalenceViolation';
  }
}

function firstDivergence(a: string, b: string): string {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  const from = Math.max(0, i - 60);
  return `at byte ${i}: …${a.slice(from, i + 80)}… vs …${b.slice(from, i + 80)}…`;
}

/**
 * The three assertions of the deferral contract, for one surface:
 *  1. DETERMINISM — the canonical path run twice yields byte-identical output
 *     (an engine that wobbles on its own can never be equivalence-gated).
 *  2. ROLE VISIBILITY (Q6) — every operational actor sees byte-identical
 *     output today; scoping must not introduce role divergence, so the
 *     current no-divergence truth is pinned here.
 *  3. SCOPED EQUIVALENCE — when `runScoped` exists, its output is
 *     byte-identical to the canonical path's, per actor.
 *
 * Note: surfaces stamp todayIso internally, so a run straddling UTC midnight
 * could differ legitimately — the once-a-day, seconds-wide window is accepted.
 */
export async function assertSurfaceEquivalence<TView>(
  surface: EngineSurface<TView>,
  operationalActors: readonly Actor[],
): Promise<void> {
  if (operationalActors.length === 0) throw new Error('assertSurfaceEquivalence needs at least one actor');

  const canonicalByActor: string[] = [];
  for (const actor of operationalActors) {
    const first = canonicalize(await surface.run(actor));
    const second = canonicalize(await surface.run(actor));
    if (first !== second) {
      throw new EquivalenceViolation(surface.name, 'DETERMINISM', `${actor.role}: ${firstDivergence(first, second)}`);
    }
    canonicalByActor.push(first);
  }

  for (let i = 1; i < canonicalByActor.length; i++) {
    if (canonicalByActor[i] !== canonicalByActor[0]) {
      throw new EquivalenceViolation(
        surface.name,
        'ROLE-VISIBILITY',
        `${operationalActors[i]!.role} diverges from ${operationalActors[0]!.role}: ${firstDivergence(canonicalByActor[i]!, canonicalByActor[0]!)}`,
      );
    }
  }

  if (surface.runScoped) {
    for (let i = 0; i < operationalActors.length; i++) {
      const scoped = canonicalize(await surface.runScoped(operationalActors[i]!));
      if (scoped !== canonicalByActor[i]) {
        throw new EquivalenceViolation(
          surface.name,
          'SCOPED-OUTPUT',
          `${operationalActors[i]!.role}: ${firstDivergence(scoped, canonicalByActor[i]!)}`,
        );
      }
    }
  }
}
