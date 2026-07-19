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
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const themeDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'theme');

/** The vendored C3 identity token version + its pinned LF-normalized sha256. */
const LOCKED_IDENTITY_VERSION = 'v1.2.0';
const LOCKED_TOKENS_SHA256 = '427d90601bfbc4676bcc1420f551f4bb61044df3503906c6898dde59819f9ec9';

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
