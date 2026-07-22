/**
 * identityTokens.test.ts — re-skin chapter, Phase 0.
 *
 * Two guarantees the locked identity depends on:
 *  1. INTEGRITY: the vendored brand tokens are byte-identical to the owner-LOCKED c3-brand
 *     v1.2.0 source (sha256 pinned). A brand-version bump is a deliberate, Neural-sequenced
 *     event that updates this hash — never a silent refresh that drifts the product palette.
 *  2. GLASS IS FLOATING-ONLY (identity law): the bridge maps every PERSISTENT "chrome" surface
 *     to an OPAQUE brand surface with no backdrop; only the ephemeral "float" tier reaches
 *     --c3-glass-*. A future bridge edit that lets a persistent surface become glass fails here.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const themeDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'theme');

/** The vendored C3 identity token version + its pinned LF-normalized sha256. */
const LOCKED_IDENTITY_VERSION = 'v1.2.0';
const LOCKED_TOKENS_SHA256 = '427d90601bfbc4676bcc1420f551f4bb61044df3503906c6898dde59819f9ec9';

/** Tablework v1.3.0 (brand-v1.3.0/6036fa3): the ADDITIVE --c3-tw-* alias layer.
 *  The identity core above is byte-identical in v1.3.0 (the frozen proof), so
 *  ONLY this file is new; its sha matches the v1.3.0 kit manifest entry. */
const TABLEWORK_VERSION = 'v1.3.0';
const TABLEWORK_TOKENS_SHA256 = 'dd50358cc4a151c7f99e42c717665767b1731e7deb8435dc390c6f7a3e4152b3';

const lf = (text: string): string => text.replace(/\r\n/g, '\n');
const read = (rel: string): string => readFileSync(join(themeDir, rel), 'utf8');

/** Pull a custom-property's declared value out of a CSS block (first match). */
function tokenValue(css: string, name: string): string {
  const m = css.match(new RegExp(`${name.replace(/[-]/g, '\\-')}\\s*:\\s*([^;]+);`));
  expect(m, `token ${name} not declared`).toBeTruthy();
  return m![1]!.trim();
}

describe('identity token integrity (Phase 0)', () => {
  it(`the vendored brand tokens are byte-identical to the LOCKED c3-brand ${LOCKED_IDENTITY_VERSION}`, () => {
    const vendored = lf(read('brand/c3.tokens.css'));
    const sha = createHash('sha256').update(vendored, 'utf8').digest('hex');
    expect(sha, `vendored tokens drifted from c3-brand ${LOCKED_IDENTITY_VERSION} — a brand bump must be a deliberate, Neural-sequenced update to this pin, not a silent refresh`).toBe(LOCKED_TOKENS_SHA256);
  });

  it('the app consumes the brand tokens as the source of truth, app primitives after (Strategy-B: no bridge, no S47 file)', () => {
    const main = lf(readFileSync(join(themeDir, '..', 'main.tsx'), 'utf8'));
    const brandAt = main.indexOf("theme/brand/c3.tokens.css");
    const appAt = main.indexOf("theme/c3-app.css");
    expect(brandAt, 'brand tokens not imported').toBeGreaterThan(-1);
    expect(appAt, 'app primitives not imported').toBeGreaterThan(-1);
    expect(appAt).toBeGreaterThan(brandAt); // derived primitives resolve against the brand
    // The sunset is REAL: the bridge and the S47 token file must never return.
    expect(main).not.toContain('c3-bridge.css');
    expect(main).not.toContain('theme/c3-tokens.css');
  });

  it(`the vendored Tablework tokens are byte-identical to c3-brand ${TABLEWORK_VERSION}, imported after the core`, () => {
    const vendored = lf(read('brand/tablework.tokens.css'));
    const sha = createHash('sha256').update(vendored, 'utf8').digest('hex');
    expect(sha, `Tablework tokens drifted from c3-brand ${TABLEWORK_VERSION} — a bump is a deliberate, Neural-sequenced pin update`).toBe(TABLEWORK_TOKENS_SHA256);
    const main = lf(readFileSync(join(themeDir, '..', 'main.tsx'), 'utf8'));
    const coreAt = main.indexOf("theme/brand/c3.tokens.css");
    const twAt = main.indexOf("theme/brand/tablework.tokens.css");
    expect(twAt, 'Tablework tokens not imported').toBeGreaterThan(-1);
    expect(twAt).toBeGreaterThan(coreAt); // the contract's fixed import order
    // Additive aliases only: a single cozy-dark block that inherits both themes.
    expect(vendored).not.toContain('fresh-light');
  });

  it('the Tablework material law holds in the vendored aliases: Room/Work opaque, glass Float-only', () => {
    const tw = lf(read('brand/tablework.tokens.css'));
    // Work tiers alias OPAQUE identity surfaces, never glass.
    for (const tier of ['base', 'subtle', 'elevated', 'raised']) {
      expect(tokenValue(tw, `--c3-tw-work-${tier}`)).toMatch(/var\(--c3-surface-/);
    }
    expect(tokenValue(tw, '--c3-tw-room-canvas')).toMatch(/var\(--c3-ground-/);
    // Only the float tier reaches the Blue Hour glass.
    expect(tokenValue(tw, '--c3-tw-float-fill')).toMatch(/var\(--c3-glass-/);
  });

  it('the Tablework component library is Fluent-free by law (the pilot boundary)', () => {
    const twDir = join(themeDir, '..', 'tablework');
    const files = readdirSync(twDir).filter((f) => /\.(ts|tsx|css)$/.test(f));
    expect(files.length, 'the tablework library exists').toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(join(twDir, f), 'utf8');
      expect(src, `${f} must not import Fluent — Tablework speaks only the brand/Tablework tokens`).not.toContain('@fluentui');
    }
  });
});

describe('GLASS AUDIT — glass is floating-only (identity law, enforced in the app primitives)', () => {
  const bridge = read('c3-app.css');

  it('persistent CHROME surfaces map to OPAQUE brand surfaces, never to --c3-glass-*', () => {
    // The chrome background is an opaque brand surface (the rail / identity bar / nav never blur).
    expect(tokenValue(bridge, '--c3-glass-chrome-bg')).not.toMatch(/glass/);
    expect(tokenValue(bridge, '--c3-glass-chrome-bg')).toMatch(/var\(--c3-surface-/);
    // No backdrop blur on persistent chrome.
    expect(tokenValue(bridge, '--c3-backdrop-chrome')).toBe('none');
  });

  it('only the ephemeral FLOAT tier reaches the Blue Hour glass', () => {
    expect(tokenValue(bridge, '--c3-glass-float-bg')).toMatch(/var\(--c3-glass-/);
    expect(tokenValue(bridge, '--c3-backdrop-float')).toMatch(/blur\(var\(--c3-glass-blur\)\)/);
  });

  it('the reduced-effects contract still collapses float to opaque with no backdrop', () => {
    // Under [data-c3-effects="reduced"] the float tier must also be opaque, backdrop off.
    const reduced = bridge.slice(bridge.indexOf("[data-c3-effects='reduced']"));
    expect(reduced).toMatch(/--c3-glass-float-bg:\s*var\(--c3-surface-[a-z]+\);/);
    expect(reduced).toMatch(/--c3-backdrop-float:\s*none;/);
  });
});
