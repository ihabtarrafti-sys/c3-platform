/**
 * palette.test.ts — Phase D: the re-expression's guarantees, pinned.
 *
 * The owner adopted Intel's Proofline direction BY RE-EXPRESSION and ⛔ never
 * by import. The condition is worth restating because it is the whole reason:
 * Proofline is 411 selector lines bound to LIGHT LITERALS, which is precisely
 * why it structurally cannot have a dark mode. **These pins exist so that
 * "it cannot have dark mode" never becomes true of us.**
 *
 * They assert three things a future change could quietly break:
 *   1. no `proofline-*` class ever entered our source (re-expression, not import);
 *   2. every truth token exists in BOTH themes (one grammar, two palettes);
 *   3. the truth artifacts bind to TOKENS, never to literal hexes.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (rel: string): string => readFileSync(join(srcDir, rel), 'utf8');

/**
 * ⚖️ CR-001/002/003 — ENUMERATE THE SURFACE, NEVER LIST THE FILES.
 *
 * All three findings were one defect wearing three faces: a case whose NAME
 * claimed a boundary ("anywhere in our source", "the truth artifacts", "every
 * truth token") while its assertions named a hand-written subset. At the audited
 * commit `no proofline-* class exists anywhere` read **three** files and omitted
 * **79** class-bearing ones.
 *
 * ⛔ A hand-listed guard does not fail when the surface grows — it goes quietly
 * out of date, and the file it misses is the one added after the guard was
 * written. That is why `theme/hearth-home.css` — the front door ratified in
 * Slice 03 — was outside every one of these claims.
 *
 * ⇒ The walk below is the fix for all three. A new stylesheet or component is
 * covered the moment it exists, without anyone remembering to add it here.
 */
function walk(dir: string, extensions: readonly string[]): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full, extensions));
    else if (extensions.some((ext) => entry.name.endsWith(ext))) found.push(full);
  }
  return found;
}

const rel = (abs: string) => relative(srcDir, abs).replace(/\\/g, '/');
/** CSS comments carry prose about hexes; only EXECUTABLE literals are violations. */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
/** The palette is DEFINED in the brand token files; everywhere else must bind to it. */
const isTokenDefinition = (path: string) => /^theme\/brand\/.*\.tokens\.css$/.test(rel(path));

describe('Phase D — Proofline RE-EXPRESSED, never imported', () => {
  it('no proofline-* class exists anywhere in our source — ALL of it, enumerated', () => {
    const sources = walk(srcDir, ['.css', '.tsx']);

    // ⛳ POSITIVE CONTROL FIRST. An assertion over an empty or shallow walk is
    // vacuously true, and would read exactly like a passing guard. This pins that
    // the walk reaches the root, reaches deep, and covers a real corpus.
    const names = sources.map(rel);
    expect(names, 'the walk must reach the app root').toContain('main.tsx');
    expect(names.some((n) => n.split('/').length >= 3), 'the walk must reach deep paths').toBe(true);
    expect(sources.length, 'a hand-listed guard read 3 files; the surface is far larger').toBeGreaterThan(50);

    const offenders = sources.filter((file) => /proofline-/.test(readFileSync(file, 'utf8'))).map(rel);
    expect(offenders, 'Proofline was adopted by RE-EXPRESSION, never by import').toEqual([]);
  });

  it('the truth tokens live in the APP layer, never in the VENDORED brand file', () => {
    // The identity-lock test caught the first version of this change editing
    // theme/brand/c3.tokens.css, which is byte-pinned to the locked c3-brand
    // v1.2.0. A brand bump is a deliberate, Neural-sequenced act; app-layer
    // roles belong to the app layer. This pin keeps that boundary.
    expect(read('theme/brand/c3.tokens.css')).not.toContain('--c3-truth-');
    expect(read('theme/c3-app.css')).toContain('--c3-truth-verified:');
  });

  it('every truth token is defined in BOTH themes — enumerated from the declarations', () => {
    // ⛔ CR-003. The previous version asserted SIX token names while the theme
    // blocks declare EIGHT — `--c3-truth-verified-wash` and
    // `--c3-truth-failed-wash` were outside a case named "every truth token".
    // A hard-coded list cannot notice a token added after it was written, which
    // is exactly the one-sided drift the case exists to prevent.
    const tokens = read('theme/c3-app.css');
    const phaseD = tokens.slice(tokens.indexOf('Phase D — THE TRUTH PALETTE'));
    const split = phaseD.indexOf("[data-c3-theme='fresh-light']");
    const dark = phaseD.slice(0, split);
    const light = phaseD.slice(split);

    const declared = (block: string) =>
      new Set([...block.matchAll(/(--c3-(?:truth|earned)[a-z-]*)\s*:/g)].map((m) => m[1] as string));
    const inDark = declared(dark);
    const inLight = declared(light);

    // Positive control: the enumeration must actually find tokens, or an empty
    // set would satisfy every comparison below.
    expect(inDark.size, 'no truth tokens found — the block markers have moved').toBeGreaterThanOrEqual(8);

    // ⚖️ SYMMETRIC. One grammar, two palettes: a token in either theme must exist
    // in the other, so drift is caught whichever side gains it.
    expect([...inDark].sort(), 'declared in cozy-dark but missing from fresh-light').toEqual(
      [...inLight].sort(),
    );
  });

  it('the truth artifacts bind to TOKENS, never to literal hexes — every stylesheet', () => {
    // ⛔ CR-002. The previous version read ONE stylesheet under a name claiming
    // "the truth artifacts". The omitted set included `theme/hearth-home.css` —
    // the front door ratified in Slice 03 — so a literal hex in the newest,
    // most-seen surface left the guard green.
    //
    // ⚖️ The boundary is stated structurally rather than by enumeration of truth
    // files, because "which files are truth artifacts" is itself a judgment that
    // goes stale: `hearth-home.css` referenced no truth token at all when this
    // was written, and would have been excluded by any token-based filter.
    // The durable law is the one Proofline broke — **the palette is DEFINED in
    // the brand token files and BOUND everywhere else.**
    const stylesheets = walk(srcDir, ['.css']);
    const definitions = stylesheets.filter(isTokenDefinition);
    const bindings = stylesheets.filter((file) => !isTokenDefinition(file));

    // ⛳ POSITIVE CONTROL: the detector must be shown to detect. The brand files
    // DO carry hexes — that is their job — so a scanner returning nothing
    // everywhere would fail here rather than pass everywhere.
    expect(definitions.length, 'the brand token files must be found').toBeGreaterThan(0);
    expect(
      definitions.some((file) => /#[0-9a-fA-F]{3,8}\b/.test(stripComments(readFileSync(file, 'utf8')))),
      'a hex detector that finds none in the palette itself is broken',
    ).toBe(true);

    const offenders = bindings
      .filter((file) => /#[0-9a-fA-F]{3,8}\b/.test(stripComments(readFileSync(file, 'utf8'))))
      .map(rel);
    expect(offenders, 'a literal hex outside the palette is what made Proofline dark-mode-incapable').toEqual(
      [],
    );

    // The states still have to be BOUND, not merely hex-free: an empty stylesheet
    // would satisfy the assertion above.
    const tw = read('tablework/tablework.css');
    const phaseD = tw.slice(tw.indexOf('Phase D — THE TRUTH PALETTE, BOUND'));
    for (const state of ['verified', 'proven-empty', 'denied', 'fetch-failed', 'stale', 'loading']) {
      expect(phaseD, `no tone bound for ${state}`).toContain(`[data-truth='${state}']`);
    }
  });
});

describe('Phase D — Dusk’s craft, carried', () => {
  it('THE EARNED GRADIENT appears only where a truth was RECORDED — never on chrome', () => {
    const tw = read('tablework/tablework.css');
    const block = tw.slice(tw.indexOf('THE EARNED GRADIENT'), tw.indexOf('COOLING LAPSE'));
    // The three earning selectors, and nothing generic.
    expect(block).toContain("[data-truth='verified']::before");
    expect(block).toContain("[data-settled='derived-true']::before");
    expect(block).toContain('.decision-record::before');
    // A superseded ruling LOSES the mark: it stands in history, not in force.
    expect(block).toContain('data-superseded-by');
    // It must not be attached to structural chrome.
    for (const chrome of ['.app-frame', '.place-link', '.tw-root >', 'body']) {
      expect(block).not.toContain(`${chrome}::before`);
    }
  });

  it('THE LAW SPEAKS SERIF on every governance sentence', () => {
    const tw = read('tablework/tablework.css');
    const block = tw.slice(tw.indexOf('THE LAW SPEAKS SERIF'), tw.indexOf('THE EARNED GRADIENT'));
    for (const voice of ['.boundary-note', '.field-error-block', 'RetentionNotice', 'VisibilityWarning', 'SettledView']) {
      expect(block, `${voice} is not in the law voice`).toContain(voice);
    }
    expect(block).toContain('serif');
  });

  it('COOLING LAPSE: the surface cools rather than dims, and affordances stay REMOVED not greyed', () => {
    const tw = read('tablework/tablework.css');
    const block = tw.slice(tw.indexOf('COOLING LAPSE'));
    expect(block).toContain('saturate(');
    // Opacity-dimming would say "disabled" where the product means "absent".
    expect(block.slice(0, block.indexOf('@media'))).not.toMatch(/opacity:\s*0?\.\d/);
  });
});
