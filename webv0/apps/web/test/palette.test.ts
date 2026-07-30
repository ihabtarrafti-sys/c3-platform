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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (rel: string): string => readFileSync(join(srcDir, rel), 'utf8');

const TRUTH_TOKENS = [
  '--c3-truth-verified',
  '--c3-truth-failed',
  '--c3-truth-stale',
  '--c3-truth-denied',
  '--c3-truth-quiet',
  '--c3-earned-gradient',
] as const;

describe('Phase D — Proofline RE-EXPRESSED, never imported', () => {
  it('no proofline-* class exists anywhere in our source', () => {
    const tw = read('tablework/tablework.css');
    expect(tw).not.toMatch(/proofline-/);
    expect(read('theme/c3-app.css')).not.toMatch(/proofline-/);
    expect(read('theme/brand/c3.tokens.css')).not.toMatch(/proofline-/);
  });

  it('the truth tokens live in the APP layer, never in the VENDORED brand file', () => {
    // The identity-lock test caught the first version of this change editing
    // theme/brand/c3.tokens.css, which is byte-pinned to the locked c3-brand
    // v1.2.0. A brand bump is a deliberate, Neural-sequenced act; app-layer
    // roles belong to the app layer. This pin keeps that boundary.
    expect(read('theme/brand/c3.tokens.css')).not.toContain('--c3-truth-');
    expect(read('theme/c3-app.css')).toContain('--c3-truth-verified:');
  });

  it('every truth token is defined in BOTH themes — the guarantee Proofline could not make', () => {
    const tokens = read('theme/c3-app.css');
    const phaseD = tokens.slice(tokens.indexOf('Phase D — THE TRUTH PALETTE'));
    const dark = phaseD.slice(0, phaseD.indexOf("[data-c3-theme='fresh-light']"));
    const light = phaseD.slice(phaseD.indexOf("[data-c3-theme='fresh-light']"));
    for (const token of TRUTH_TOKENS) {
      expect(dark, `${token} missing from cozy-dark`).toContain(`${token}:`);
      expect(light, `${token} missing from fresh-light`).toContain(`${token}:`);
    }
  });

  it('the truth artifacts bind to TOKENS, never to literal hexes', () => {
    const tw = read('tablework/tablework.css');
    const phaseD = tw.slice(tw.indexOf('Phase D — THE TRUTH PALETTE, BOUND'));
    expect(phaseD.length).toBeGreaterThan(0);
    // A literal hex in this block would re-create exactly what made Proofline
    // dark-mode-incapable.
    expect(phaseD).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
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
